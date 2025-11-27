import json

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db.models import Q, Count
from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404, redirect
from django.utils import timezone

from routes.models import Route
from .models import Conversation, PrivateMessage, RouteChat, RouteChatMessage


@login_required
def chat_dashboard(request):
    """Дашборд чатов"""
    # Личные диалоги
    conversations = Conversation.objects.filter(participants=request.user)

    # Подготавливаем данные для шаблона
    conversations_data = []
    for conversation in conversations:
        other_user = conversation.get_other_participant(request.user)
        if other_user:
            conversations_data.append({
                "conversation": conversation,
                "other_user": other_user,
                "unread_count": conversation.get_unread_count(request.user),
                "last_message": conversation.get_last_message(),
            })

    # Чаты маршрутов с ОПТИМИЗИРОВАННЫМ подсчетом сообщений
    user_routes_chats = RouteChat.objects.filter(
        route__author=request.user
    ).annotate(
        messages_count=Count('messages')
    )

    # Чаты маршрутов, где пользователь участник
    participant_chats = RouteChat.objects.filter(
        route__privacy="personal", route__shared_with=request.user
    ).annotate(
        messages_count=Count('messages')
    )

    # Публичные маршруты с чатами
    public_chats = RouteChat.objects.filter(
        route__privacy="public", route__is_active=True
    ).exclude(route__author=request.user).annotate(
        messages_count=Count('messages')
    )[:10]

    # Друзья для быстрого начала диалога
    friends = User.objects.filter(
        Q(
            friendship_requests_sent__to_user=request.user,
            friendship_requests_sent__status="accepted",
        )
        | Q(
            friendship_requests_received__from_user=request.user,
            friendship_requests_received__status="accepted",
        )
    ).distinct()

    context = {
        "conversations_data": conversations_data,
        "user_routes_chats": user_routes_chats,
        "participant_chats": participant_chats,
        "public_chats": public_chats,
        "friends": friends,
    }

    return render(request, "chat/dashboard.html", context)



@login_required
def private_chat(request, user_id):
    """Личный чат с пользователем"""
    other_user = get_object_or_404(User, id=user_id)

    # Находим или создаем диалог
    conversation = (
        Conversation.objects.filter(participants=request.user)
        .filter(participants=other_user)
        .first()
    )

    if not conversation:
        conversation = Conversation.objects.create()
        conversation.participants.add(request.user, other_user)

    # Получаем сообщения (последние 100)
    messages = conversation.messages.all().order_by("created_at")

    # Помечаем сообщения как прочитанные
    conversation.messages.exclude(sender=request.user).update(is_read=True)

    # Получаем количество принятых друзей
    try:
        accepted_friends_count = other_user.friendship_requests_sent.filter(
            status="accepted"
        ).count()
    except:
        accepted_friends_count = 0

    context = {
        'conversation': conversation,
        'other_user': other_user,
        'accepted_friends_count': accepted_friends_count,
    }

    return render(request, "chat/private_chat.html", context)


@login_required
def route_chat(request, route_id):
    """Чат маршрута"""
    route = get_object_or_404(Route, id=route_id)

    # Проверка доступа
    from routes.views import can_view_route

    if not can_view_route(request.user, route):
        return redirect("home")

    # Получаем или создаем чат маршрута
    route_chat, created = RouteChat.objects.get_or_create(route=route)

    chat_messages = route_chat.messages.all().order_by("timestamp")[:100]

    context = {
        "route": route,
        "chat_messages": chat_messages,
    }

    return render(request, "chat/route_chat.html", context)


@login_required
def send_private_message(request):
    """Отправка личного сообщения (AJAX)"""
    if request.method == "POST":
        try:
            # Проверяем Content-Type
            if request.content_type != "application/json":
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Invalid content type. Use application/json",
                    }
                )

            data = json.loads(request.body)
            user_id = data.get("user_id")
            message_content = data.get("message")

            # Валидация данных
            if not message_content or not user_id:
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Отсутствуют обязательные данные: user_id или message",
                    }
                )

            if len(message_content.strip()) == 0:
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Сообщение не может быть пустым",
                    }
                )

            if len(message_content) > 1000:
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Сообщение слишком длинное (максимум 1000 символов)",
                    }
                )

            other_user = get_object_or_404(User, id=user_id)

            # Проверяем, не пытается ли пользователь отправить сообщение самому себе
            if other_user == request.user:
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Нельзя отправить сообщение самому себе",
                    }
                )

            # Находим или создаем диалог
            conversation = (
                Conversation.objects.filter(participants=request.user)
                .filter(participants=other_user)
                .first()
            )

            if not conversation:
                conversation = Conversation.objects.create()
                conversation.participants.add(request.user, other_user)

            # Создаем сообщение
            message_obj = PrivateMessage.objects.create(
                conversation=conversation,
                sender=request.user,
                content=message_content.strip(),
            )

            # Обновляем время последнего обновления беседы
            conversation.updated_at = timezone.now()
            conversation.save()

            return JsonResponse(
                {
                    "success": True,
                    "message_id": message_obj.id,
                    "content": message_obj.content,
                    "sender": message_obj.sender.username,
                    "sender_id": message_obj.sender.id,
                    "created_at": message_obj.created_at.strftime("%H:%M"),
                    "created_at_iso": message_obj.created_at.isoformat(),
                    "conversation_id": conversation.id,
                }
            )

        except json.JSONDecodeError:
            return JsonResponse(
                {"success": False, "error": "Неверный JSON формат"}
            )
        except Exception as e:
            return JsonResponse(
                {
                    "success": False,
                    "error": f"Внутренняя ошибка сервера: {str(e)}",
                }
            )

    return JsonResponse(
        {"success": False, "error": "Only POST requests are allowed"}
    )


@login_required
def send_route_message(request):
    """Отправка сообщения в чат маршрута (AJAX)"""
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            route_id = data.get("route_id")
            message_content = data.get("message")

            if not message_content or not route_id:
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Отсутствуют обязательные данные",
                    }
                )

            route = get_object_or_404(Route, id=route_id)

            # Проверка доступа
            from routes.views import can_view_route

            if not can_view_route(request.user, route):
                return JsonResponse(
                    {"success": False, "error": "Доступ запрещен"}
                )

            # Получаем или создаем чат
            route_chat, created = RouteChat.objects.get_or_create(route=route)

            # Создаем сообщение
            message_obj = RouteChatMessage.objects.create(
                route_chat=route_chat,
                user=request.user,
                message=message_content.strip(),
            )

            return JsonResponse(
                {
                    "success": True,
                    "message_id": message_obj.id,
                    "content": message_obj.message,
                    "sender": message_obj.user.username,
                    "sender_id": message_obj.user.id,
                    "created_at": message_obj.timestamp.strftime("%H:%M"),
                }
            )

        except Exception as e:
            return JsonResponse(
                {"success": False, "error": f"Ошибка отправки: {str(e)}"}
            )

    return JsonResponse(
        {"success": False, "error": "Only POST requests are allowed"}
    )


@login_required
def get_private_messages(request, conversation_id):
    """Получение сообщений беседы (AJAX)"""
    try:
        conversation = get_object_or_404(Conversation, id=conversation_id)

        # Проверяем, что пользователь участник беседы
        if request.user not in conversation.participants.all():
            return JsonResponse({"success": False, "error": "Доступ запрещен"})

        # Получаем параметры для пагинации
        last_message_id = request.GET.get("last_message_id")

        if last_message_id:
            # Получаем только новые сообщения
            messages = conversation.messages.filter(
                id__gt=last_message_id
            ).order_by("created_at")
        else:
            # Получаем все сообщения (последние 100)
            messages = conversation.messages.all().order_by("created_at")[:100]

        messages_data = []

        for message in messages:
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
                }
            )

        return JsonResponse(
            {
                "success": True,
                "messages": messages_data,
                "conversation_id": conversation.id,
                "has_more": False,
            }
        )

    except Exception as e:
        return JsonResponse(
            {"success": False, "error": f"Ошибка загрузки сообщений: {str(e)}"}
        )


@login_required
def get_route_messages(request, route_id):
    """Получение сообщений чата маршрута (AJAX)"""
    try:
        route = get_object_or_404(Route, id=route_id)

        # Проверка доступа
        from routes.views import can_view_route

        if not can_view_route(request.user, route):
            return JsonResponse({"success": False, "error": "Доступ запрещен"})

        # Получаем чат
        route_chat = get_object_or_404(RouteChat, route=route)

        # Получаем параметры для пагинации
        last_message_id = request.GET.get("last_id")

        if last_message_id:
            # Получаем только новые сообщения
            messages = route_chat.messages.filter(
                id__gt=last_message_id
            ).order_by("timestamp")
        else:
            # Получаем все сообщения (последние 100)
            messages = route_chat.messages.all().order_by("timestamp")[:100]

        messages_data = []

        for message in messages:
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

        return JsonResponse(
            {"success": True, "messages": messages_data, "route_id": route.id}
        )

    except Exception as e:
        return JsonResponse(
            {"success": False, "error": f"Ошибка загрузки сообщений: {str(e)}"}
        )


@login_required
def get_conversation_info(request, conversation_id):
    """Получение информации о беседе"""
    try:
        conversation = get_object_or_404(Conversation, id=conversation_id)

        # Проверяем, что пользователь участник беседы
        if request.user not in conversation.participants.all():
            return JsonResponse({"success": False, "error": "Доступ запрещен"})

        other_user = conversation.get_other_participant(request.user)

        return JsonResponse(
            {
                "success": True,
                "conversation": {
                    "id": conversation.id,
                    "updated_at": conversation.updated_at.isoformat(),
                },
                "other_user": {
                    "id": other_user.id,
                    "username": other_user.username,
                    "routes_count": other_user.routes.count(),
                },
            }
        )

    except Exception as e:
        return JsonResponse(
            {
                "success": False,
                "error": f"Ошибка загрузки информации: {str(e)}",
            }
        )


@login_required
def mark_conversation_as_read(request, conversation_id):
    """Пометить все сообщения в беседе как прочитанные (AJAX)"""
    conversation = get_object_or_404(Conversation, id=conversation_id)

    # Проверяем, что пользователь участник беседы
    if request.user not in conversation.participants.all():
        return JsonResponse({"success": False, "error": "Доступ запрещен"})

    conversation.mark_messages_as_read(request.user)

    return JsonResponse({"success": True})
