import json
import logging

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models import Q, Count, Prefetch
from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404, redirect
from django.utils import timezone
from django.views.decorators.http import require_http_methods, require_POST

from routes.models import Route
from routes.views import can_view_route
from .models import Conversation, PrivateMessage, RouteChat, RouteChatMessage

# Настройка логгера
logger = logging.getLogger(__name__)


class ChatService:
    """Сервисный класс для бизнес-логики чатов"""

    @staticmethod
    def get_user_conversations(user):
        """Получить диалоги пользователя с оптимизацией"""
        return (
            Conversation.objects.filter(participants=user)
            .prefetch_related(
                Prefetch(
                    "participants",
                    queryset=User.objects.only("id", "username"),
                ),
                "messages",
            )
            .annotate(
                unread_count=Count(
                    "messages",
                    filter=Q(messages__is_read=False)
                    & ~Q(messages__sender=user),
                )
            )
            .order_by("-updated_at")
        )

    @staticmethod
    def get_or_create_conversation(user1, user2):
        """Найти или создать диалог между двумя пользователями"""
        if user1 == user2:
            raise ValidationError("Нельзя создать диалог с самим собой")

        # Ищем существующий диалог
        conversation = (
            Conversation.objects.filter(participants=user1)
            .filter(participants=user2)
            .first()
        )

        if not conversation:
            with transaction.atomic():
                conversation = Conversation.objects.create()
                conversation.participants.add(user1, user2)
                logger.info(
                    f"Создан новый диалог между {user1.username} и {user2.username}"
                )

        return conversation

    @staticmethod
    def validate_message_content(content):
        """Валидация содержания сообщения"""
        if not content or not content.strip():
            raise ValidationError("Сообщение не может быть пустым")

        content = content.strip()

        if len(content) > 1000:
            raise ValidationError(
                "Сообщение слишком длинное (максимум 1000 символов)"
            )

        return content

    @staticmethod
    def get_route_chat_with_access_check(user, route_id):
        """Получить чат маршрута с проверкой доступа"""
        route = get_object_or_404(Route, id=route_id)

        if not can_view_route(user, route):
            raise PermissionDenied("У вас нет доступа к этому маршруту")

        route_chat, created = RouteChat.objects.get_or_create(route=route)
        return route_chat, route


class JSONResponseMixin:
    """Миксин для JSON ответов"""

    @staticmethod
    def success_response(data=None):
        """Успешный JSON ответ"""
        response_data = {"success": True}
        if data:
            response_data.update(data)
        return JsonResponse(response_data)

    @staticmethod
    def error_response(message, status=400, error_code=None):
        """Ошибочный JSON ответ"""
        response_data = {"success": False, "error": message}
        if error_code:
            response_data["error_code"] = error_code

        return JsonResponse(response_data, status=status)

    @staticmethod
    def parse_json_request(request):
        """Парсинг JSON запроса"""
        if request.content_type != "application/json":
            raise ValidationError("Invalid content type. Use application/json")

        try:
            return json.loads(request.body)
        except json.JSONDecodeError:
            raise ValidationError("Неверный JSON формат")


@login_required
def chat_dashboard(request):
    """Дашборд чатов с оптимизированными запросами"""
    cache_key = f"chat_dashboard_{request.user.id}"
    cached_data = cache.get(cache_key)

    if cached_data:
        return render(request, "chat/dashboard.html", cached_data)

    try:
        # Личные диалоги с оптимизацией
        conversations = ChatService.get_user_conversations(request.user)

        conversations_data = []
        total_unread_count = 0
        
        for conversation in conversations:
            other_user = conversation.get_other_participant(request.user)
            if other_user:
                last_message = conversation.messages.order_by(
                    "-created_at"
                ).first()

                # Получаем количество непрочитанных сообщений
                unread_count = conversation.unread_count
                total_unread_count += unread_count

                conversations_data.append(
                    {
                        "conversation": conversation,
                        "other_user": other_user,
                        "unread_count": unread_count,
                        "last_message": last_message,
                        "is_online": True,  # Здесь нужно подключить логику онлайн статуса
                    }
                )

        # Чаты маршрутов с оптимизированными запросами
        user_routes_chats = (
            RouteChat.objects.filter(route__author=request.user)
            .select_related("route")
            .order_by("-route__created_at")
        )

        # Чаты маршрутов, где пользователь участник
        participant_chats = (
        RouteChat.objects.filter(
                route__shared_with=request.user
            )
            .exclude(route__author=request.user)
            .select_related("route")
            .order_by("-route__created_at")
        )

        # Публичные маршруты с чатами
        public_chats = (
            RouteChat.objects.filter(
                route__privacy="public", route__is_active=True
            )
            .select_related("route", "route__author")
            .exclude(route__author=request.user)
            .order_by("-route__created_at")[:10]
        )

        # Друзья для быстрого начала диалога
        friends = (
            User.objects.filter(
                Q(
                    friendship_requests_sent__to_user=request.user,
                    friendship_requests_sent__status="accepted",
                )
                | Q(
                    friendship_requests_received__from_user=request.user,
                    friendship_requests_received__status="accepted",
                )
            )
            .distinct()
            .only("id", "username")
        )

        # Находим друзей без диалогов
        friends_without_chats = []
        if friends.exists() and conversations_data:
            existing_user_ids = [data['other_user'].id for data in conversations_data]
            friends_without_chats = friends.exclude(id__in=existing_user_ids)
        elif friends.exists():
            friends_without_chats = friends

        context = {
            "conversations_data": conversations_data,
            "user_routes_chats": user_routes_chats,
            "participant_chats": participant_chats,
            "public_chats": public_chats,
            "friends": friends,
            "friends_without_chats": friends_without_chats[:5],  # Ограничиваем до 5
            "total_unread_count": total_unread_count,
        }

        # Кешируем данные дашборда на 2 минуты
        cache.set(cache_key, context, 120)

        return render(request, "chat/dashboard.html", context)

    except Exception as e:
        logger.error(
            f"Error in chat_dashboard for user {request.user.id}: {e}"
        )
        messages.error(request, "Произошла ошибка при загрузке чатов")
        return render(
            request,
            "chat/dashboard.html",
            {
                "conversations_data": [],
                "user_routes_chats": [],
                "participant_chats": [],
                "public_chats": [],
                "friends": [],
                "friends_without_chats": [],
                "total_unread_count": 0,
            },
        )


@login_required
def private_chat(request, user_id):
    """Личный чат с пользователем"""
    try:
        other_user = get_object_or_404(User, id=user_id)

        if other_user == request.user:
            messages.error(request, "Нельзя начать диалог с самим собой")
            return redirect("chat:chat_dashboard")

        # Находим или создаем диалог
        conversation = ChatService.get_or_create_conversation(
            request.user, other_user
        )

        # Получаем сообщения с оптимизацией
        messages_qs = conversation.messages.select_related("sender").order_by(
            "created_at"
        )

        # Помечаем сообщения как прочитанные
        unread_messages = conversation.messages.filter(is_read=False).exclude(
            sender=request.user
        )

        if unread_messages.exists():
            unread_messages.update(is_read=True)
            # Инвалидируем кеш дашборда
            cache.delete(f"chat_dashboard_{request.user.id}")

        # Получаем количество принятых друзей
        try:
            accepted_friends_count = (
                other_user.friendship_requests_sent.filter(
                    status="accepted"
                ).count()
            )
        except AttributeError:
            accepted_friends_count = 0

        context = {
            "conversation": conversation,
            "other_user": other_user,
            "accepted_friends_count": accepted_friends_count,
        }

        return render(request, "chat/private_chat.html", context)

    except Exception as e:
        logger.error(f"Error in private_chat for user {request.user.id}: {e}")
        messages.error(request, "Произошла ошибка при загрузке чата")
        return redirect("chat:chat_dashboard")


@login_required
def route_chat(request, route_id):
    """Чат маршрута"""
    try:
        route_chat, route = ChatService.get_route_chat_with_access_check(
            request.user, route_id
        )

        # Получаем сообщения с оптимизацией
        chat_messages = route_chat.messages.select_related("user").order_by(
            "-timestamp"
        )[:100]

        context = {
            "route": route,
            "chat_messages": chat_messages,
        }

        return render(request, "chat/route_chat.html", context)

    except PermissionDenied:
        messages.error(request, "У вас нет доступа к этому чату")
        return redirect("routes:route_list")
    except Exception as e:
        logger.error(f"Error in route_chat for user {request.user.id}: {e}")
        messages.error(request, "Произошла ошибка при загрузке чата")
        return redirect("routes:route_list")


@login_required
@require_POST
def send_private_message(request):
    """Отправка личного сообщения (AJAX)"""
    try:
        data = JSONResponseMixin.parse_json_request(request)
        user_id = data.get("user_id")
        message_content = data.get("message")

        # Валидация данных
        if not user_id:
            return JSONResponseMixin.error_response("Отсутствует user_id")

        validated_content = ChatService.validate_message_content(
            message_content
        )

        other_user = get_object_or_404(User, id=user_id)

        # Проверяем, не пытается ли пользователь отправить сообщение самому себе
        if other_user == request.user:
            return JSONResponseMixin.error_response(
                "Нельзя отправить сообщение самому себе"
            )

        with transaction.atomic():
            # Находим или создаем диалог
            conversation = ChatService.get_or_create_conversation(
                request.user, other_user
            )

            # Создаем сообщение
            message_obj = PrivateMessage.objects.create(
                conversation=conversation,
                sender=request.user,
                content=validated_content,
            )

            # Обновляем время последнего обновления беседы
            conversation.updated_at = timezone.now()
            conversation.save()

            # Инвалидируем кеш дашборда для обоих пользователей
            cache.delete(f"chat_dashboard_{request.user.id}")
            cache.delete(f"chat_dashboard_{other_user.id}")

        logger.info(f"User {request.user.id} sent message to {other_user.id}")

        return JSONResponseMixin.success_response(
            {
                "message_id": message_obj.id,
                "content": message_obj.content,
                "sender": message_obj.sender.username,
                "sender_id": message_obj.sender.id,
                "created_at": message_obj.created_at.strftime("%H:%M"),
                "created_at_iso": message_obj.created_at.isoformat(),
                "conversation_id": conversation.id,
            }
        )

    except ValidationError as e:
        return JSONResponseMixin.error_response(str(e))
    except Exception as e:
        logger.error(
            f"Error sending private message for user {request.user.id}: {e}"
        )
        return JSONResponseMixin.error_response(
            "Внутренняя ошибка сервера", status=500, error_code="server_error"
        )


@login_required
@require_POST
def send_route_message(request):
    """Отправка сообщения в чат маршрута (AJAX)"""
    try:
        data = JSONResponseMixin.parse_json_request(request)
        route_id = data.get("route_id")
        message_content = data.get("message")

        if not route_id:
            return JSONResponseMixin.error_response("Отсутствует route_id")

        validated_content = ChatService.validate_message_content(
            message_content
        )

        with transaction.atomic():
            route_chat, route = ChatService.get_route_chat_with_access_check(
                request.user, route_id
            )

            # Создаем сообщение
            message_obj = RouteChatMessage.objects.create(
                route_chat=route_chat,
                user=request.user,
                message=validated_content,
            )

        logger.info(
            f"User {request.user.id} sent message to route chat {route_id}"
        )

        return JSONResponseMixin.success_response(
            {
                "message_id": message_obj.id,
                "content": message_obj.message,
                "sender": message_obj.user.username,
                "sender_id": message_obj.user.id,
                "created_at": message_obj.timestamp.strftime("%H:%M"),
                "route_id": route.id,
            }
        )

    except (ValidationError, PermissionDenied) as e:
        return JSONResponseMixin.error_response(str(e))
    except Exception as e:
        logger.error(
            f"Error sending route message for user {request.user.id}: {e}"
        )
        return JSONResponseMixin.error_response(
            "Ошибка отправки сообщения", status=500
        )


@login_required
@require_http_methods(["GET"])
def get_private_messages(request, conversation_id):
    """Получение сообщений беседы (AJAX)"""
    try:
        conversation = get_object_or_404(Conversation, id=conversation_id)

        # Проверяем, что пользователь участник беседы
        if request.user not in conversation.participants.all():
            return JSONResponseMixin.error_response(
                "Доступ запрещен", status=403
            )

        # Получаем параметры для пагинации
        last_message_id = request.GET.get("last_message_id")
        limit = int(request.GET.get("limit", 100))

        # Базовый запрос с оптимизацией
        messages_qs = conversation.messages.select_related("sender").order_by(
            "-created_at"
        )

        if last_message_id:
            # Получаем только новые сообщения
            messages_qs = messages_qs.filter(id__gt=last_message_id)

        messages_qs = messages_qs[:limit]
        messages_list = list(messages_qs)
        messages_list.reverse()  # Возвращаем в правильном порядке

        messages_data = []
        for message in messages_list:
            messages_data.append(
                {
                    "id": message.id,
                    "content": message.content,
                    "sender": message.sender.username,
                    "sender_id": message.sender.id,
                    "created_at": message.created_at.strftime("%H:%M"),
                    "created_at_full": message.created_at.strftime(
                        "%d.%m.%Y %H:%M"
                    ),
                    "is_own": message.sender == request.user,
                    "is_read": message.is_read,
                }
            )

        return JSONResponseMixin.success_response(
            {
                "messages": messages_data,
                "conversation_id": conversation.id,
                "has_more": len(messages_list) == limit,
            }
        )

    except Exception as e:
        logger.error(
            f"Error getting private messages for user {request.user.id}: {e}"
        )
        return JSONResponseMixin.error_response(
            "Ошибка загрузки сообщений", status=500
        )


@login_required
@require_http_methods(["GET"])
def get_route_messages(request, route_id):
    """Получение сообщений чата маршрута (AJAX)"""
    try:
        route_chat, route = ChatService.get_route_chat_with_access_check(
            request.user, route_id
        )

        # Получаем параметры для пагинации
        last_message_id = request.GET.get("last_id")
        limit = int(request.GET.get("limit", 100))

        # Базовый запрос с оптимизацией
        messages_qs = route_chat.messages.select_related("user").order_by(
            "-timestamp"
        )

        if last_message_id:
            messages_qs = messages_qs.filter(id__gt=last_message_id)

        messages_qs = messages_qs[:limit]
        messages_list = list(messages_qs)
        messages_list.reverse()  # Возвращаем в правильном порядке

        messages_data = []
        for message in messages_list:
            messages_data.append(
                {
                    "id": message.id,
                    "content": message.message,
                    "sender": message.user.username,
                    "sender_id": message.user.id,
                    "created_at": message.timestamp.strftime("%H:%M"),
                    "is_own": message.user == request.user,
                }
            )

        return JSONResponseMixin.success_response(
            {
                "messages": messages_data,
                "route_id": route.id,
                "has_more": len(messages_list) == limit,
            }
        )

    except (PermissionDenied, ValidationError) as e:
        return JSONResponseMixin.error_response(str(e), status=403)
    except Exception as e:
        logger.error(
            f"Error getting route messages for user {request.user.id}: {e}"
        )
        return JSONResponseMixin.error_response(
            "Ошибка загрузки сообщений", status=500
        )


@login_required
@require_http_methods(["GET"])
def get_conversation_info(request, conversation_id):
    """Получение информации о беседе"""
    try:
        conversation = get_object_or_404(Conversation, id=conversation_id)

        # Проверяем, что пользователь участник беседы
        if request.user not in conversation.participants.all():
            return JSONResponseMixin.error_response(
                "Доступ запрещен", status=403
            )

        other_user = conversation.get_other_participant(request.user)

        if not other_user:
            return JSONResponseMixin.error_response(
                "Диалог не найден", status=404
            )

        return JSONResponseMixin.success_response(
            {
                "conversation": {
                    "id": conversation.id,
                    "updated_at": conversation.updated_at.isoformat(),
                    "unread_count": conversation.messages.filter(is_read=False)
                    .exclude(sender=request.user)
                    .count(),
                },
                "other_user": {
                    "id": other_user.id,
                    "username": other_user.username,
                    "is_online": getattr(other_user, "is_online", False),
                    "last_seen": getattr(other_user, "last_seen", None),
                    "routes_count": other_user.routes.count(),
                },
            }
        )

    except Exception as e:
        logger.error(
            f"Error getting conversation info for user {request.user.id}: {e}"
        )
        return JSONResponseMixin.error_response(
            "Ошибка загрузки информации", status=500
        )


@login_required
@require_POST
def mark_conversation_as_read(request, conversation_id):
    """Пометить все сообщения в беседе как прочитанные (AJAX)"""
    try:
        conversation = get_object_or_404(Conversation, id=conversation_id)

        # Проверяем, что пользователь участник беседы
        if request.user not in conversation.participants.all():
            return JSONResponseMixin.error_response(
                "Доступ запрещен", status=403
            )

        with transaction.atomic():
            updated_count = (
                conversation.messages.filter(is_read=False)
                .exclude(sender=request.user)
                .update(is_read=True)
            )

            # Инвалидируем кеш дашборда
            cache.delete(f"chat_dashboard_{request.user.id}")

        logger.info(
            f"User {request.user.id} marked conversation {conversation_id} as read"
        )

        return JSONResponseMixin.success_response(
            {"updated_count": updated_count}
        )

    except Exception as e:
        logger.error(
            f"Error marking conversation as read for user {request.user.id}: {e}"
        )
        return JSONResponseMixin.error_response(
            "Ошибка обновления статуса сообщений", status=500
        )


@login_required
@require_http_methods(["GET"])
def get_unread_counts(request):
    """Получить количество непрочитанных сообщений (AJAX)"""
    try:
        # Общее количество непрочитанных сообщений
        total_unread = (
            PrivateMessage.objects.filter(
                conversation__participants=request.user, is_read=False
            )
            .exclude(sender=request.user)
            .count()
        )

        # Количество непрочитанных по диалогам
        conversations_unread = (
            Conversation.objects.filter(participants=request.user)
            .annotate(
                unread_count=Count(
                    "messages",
                    filter=Q(messages__is_read=False)
                    & ~Q(messages__sender=request.user),
                )
            )
            .values("id", "unread_count")
        )

        return JSONResponseMixin.success_response(
            {
                "total_unread": total_unread,
                "conversations": list(conversations_unread),
            }
        )

    except Exception as e:
        logger.error(
            f"Error getting unread counts for user {request.user.id}: {e}"
        )
        return JSONResponseMixin.error_response(
            "Ошибка загрузки счетчиков", status=500
        )


@login_required
@require_POST
def delete_conversation(request, conversation_id):
    """Удалить диалог (AJAX)"""
    try:
        conversation = get_object_or_404(Conversation, id=conversation_id)

        # Проверяем, что пользователь участник беседы
        if request.user not in conversation.participants.all():
            return JSONResponseMixin.error_response(
                "Доступ запрещен", status=403
            )

        with transaction.atomic():
            # Удаляем пользователя из диалога
            conversation.participants.remove(request.user)

            # Если в диалоге не осталось участников, удаляем его полностью
            if conversation.participants.count() == 0:
                conversation.delete()

            # Инвалидируем кеш дашборда
            cache.delete(f"chat_dashboard_{request.user.id}")

        logger.info(
            f"User {request.user.id} deleted conversation {conversation_id}"
        )

        return JSONResponseMixin.success_response({"message": "Диалог удален"})

    except Exception as e:
        logger.error(
            f"Error deleting conversation for user {request.user.id}: {e}"
        )
        return JSONResponseMixin.error_response(
            "Ошибка удаления диалога", status=500
        )
