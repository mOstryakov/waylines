# routes/views.py
__all__ = ()

import json
import math
import os
import time
from io import BytesIO
from django.core.files.base import ContentFile
import base64

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_POST
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.paginator import Paginator
from django.db.models import Q, Count, Avg, Max
from django.db.models import Prefetch
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.shortcuts import render, get_object_or_404, redirect
from django.utils import timezone
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.core.files import File
from django.http import HttpResponse
from django.conf import settings
from pathlib import Path
from django.core.files.base import ContentFile
import traceback

from routes.models import (
    Route,
    RoutePoint,
    RouteFavorite,
    RouteRating,
    RouteComment,
    PointComment,
    User,
)
from routes.models import RoutePhoto, PointPhoto
from users.models import Friendship
from interactions.models import Favorite, Rating, Comment


def home(request):
    # Получаем реальную статистику
    total_routes = Route.objects.filter(is_active=True).count()
    total_users = User.objects.count()

    # Считаем уникальные страны
    total_countries = (
        Route.objects.filter(is_active=True)
        .values("country")
        .distinct()
        .count()
    )

    # Считаем маршруты по типам (только активные)
    walking_count = Route.objects.filter(
        route_type="walking", is_active=True
    ).count()
    driving_count = Route.objects.filter(
        route_type="driving", is_active=True
    ).count()
    cycling_count = Route.objects.filter(
        route_type="cycling", is_active=True
    ).count()

    # Популярные маршруты
    popular_routes = Route.objects.filter(is_active=True).order_by(
        "-created_at"
    )[:6]

    user_favorites_ids = []
    if request.user.is_authenticated:
        user_favorites_ids = Favorite.objects.filter(
            user=request.user
        ).values_list("route_id", flat=True)

    context = {
        "popular_routes": popular_routes,
        "walking_count": walking_count,
        "driving_count": driving_count,
        "cycling_count": cycling_count,
        "total_routes": total_routes,
        "total_users": total_users,
        "total_countries": total_countries,
        "user_favorites_ids": list(user_favorites_ids),
    }

    return render(request, "home.html", context)


def all_routes(request):
    """Все публичные маршруты"""
    # Получаем параметры фильтрации
    route_type = request.GET.get("type", "")
    search_query = request.GET.get("q", "")
    sort_by = request.GET.get("sort", "newest")
    
    # Начинаем с базового QuerySet
    routes = Route.objects.filter(privacy="public", is_active=True).prefetch_related('photos')

    # Применяем фильтры
    if route_type:
        routes = routes.filter(route_type=route_type)
    
    if search_query:
        routes = routes.filter(
            Q(name__icontains=search_query)
            | Q(description__icontains=search_query)
            | Q(short_description__icontains=search_query)  # ИСПРАВЛЕНО: было icontains(search_query)
            | Q(points__name__icontains=search_query)
            | Q(points__description__icontains=search_query)
        ).distinct()

    # Аннотируем для сортировки
    routes = routes.annotate(
        avg_rating=Avg("ratings__rating"),  # или "ratings__score" в зависимости от модели
        rating_count=Count("ratings"),
        favorites_count=Count("favorites")
    )

    # Применяем сортировку
    if sort_by == "popular":
        routes = routes.order_by("-favorites_count", "-created_at")
    elif sort_by == "rating":
        # Сначала сортируем по рейтингу, затем по количеству оценок
        routes = routes.order_by(
            "-avg_rating", 
            "-rating_count", 
            "-created_at"
        )
    else:  # newest - по умолчанию
        routes = routes.order_by("-created_at")

    # Пагинация
    paginator = Paginator(routes, 12)
    page_number = request.GET.get("page")
    page_obj = paginator.get_page(page_number)

    user_favorites_ids = []
    if request.user.is_authenticated:
        user_favorites_ids = Favorite.objects.filter(
            user=request.user
        ).values_list("route_id", flat=True)

    # Подготовка контекста
    context = {
        "page_obj": page_obj,
        "route_types": Route.ROUTE_TYPE_CHOICES,
        "current_sort": sort_by,
        "search_query": search_query,
        "selected_type": route_type,
        "user_favorites_ids": list(user_favorites_ids),
        "get_params": {
            "q": search_query,
            "type": route_type,
            "sort": sort_by
        }
    }

    # Уведомления о друзьях
    if request.user.is_authenticated:
        context["pending_friend_requests"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5]
        context["pending_requests_count"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count()

    return render(request, "routes/all_routes.html", context)


@login_required
def my_routes(request):
    """Маршруты пользователя с разделением на активные/неактивные/избранное"""
    try:
        # 1. Маршруты пользователя (авторские)
        user_routes = Route.objects.filter(author=request.user).prefetch_related('photos')
        
        # Аннотируем средний рейтинг
        user_routes = user_routes.annotate(
            rating=Avg("ratings__rating"),
            rating_count=Count("ratings")
        ).order_by("-created_at")
        
        # Разделяем маршруты на активные и неактивные
        active_routes = user_routes.filter(is_active=True)
        inactive_routes = user_routes.filter(is_active=False)
        
        # 2. Избранные маршруты пользователя (из interactions)
        user_favorites_ids = []
        favorite_routes_list = []
        
        if request.user.is_authenticated:
            # Получаем ID всех избранных маршрутов для индикаторов в карточках
            user_favorites_ids = Favorite.objects.filter(
                user=request.user
            ).values_list("route_id", flat=True)
            
            # Получаем маршруты для вкладки "Избранное"
            favorites = Favorite.objects.filter(
                user=request.user
            ).select_related('route').order_by('-created_at')
            
            for fav in favorites:
                if fav.route.is_active:  # Показываем только активные маршруты
                    favorite_routes_list.append(fav.route)
            
            # Аннотируем избранные маршруты
            favorite_routes = Route.objects.filter(
                id__in=[r.id for r in favorite_routes_list]
            ).prefetch_related('photos').annotate(
                rating=Avg("ratings__rating"),
                rating_count=Count("ratings")
            )
        else:
            favorite_routes = []
        
        # Считаем количество
        total_count = active_routes.count() + inactive_routes.count()
        favorites_count = len(favorite_routes_list)
        
        context = {
            "active_routes": active_routes,
            "inactive_routes": inactive_routes,
            "favorite_routes": favorite_routes,
            "favorites_count": favorites_count,
            "total_count": total_count,
            "user_favorites_ids": list(user_favorites_ids),
        }
        
        # Добавляем уведомления о друзьях если пользователь авторизован
        if request.user.is_authenticated:
            context["pending_friend_requests"] = Friendship.objects.filter(
                to_user=request.user, status="pending"
            )[:5]
            context["pending_requests_count"] = Friendship.objects.filter(
                to_user=request.user, status="pending"
            ).count()
        
        return render(request, 'routes/my_routes.html', context)
        
    except Exception as e:
        print(f"Ошибка в my_routes: {str(e)}")
        import traceback
        traceback.print_exc()
        
        # Возвращаем пустые данные в случае ошибки
        context = {
            'active_routes': [],
            'inactive_routes': [],
            'favorite_routes': [],
            'favorites_count': 0,
            'total_count': 0,
            'user_favorites_ids': [],
        }
        
        if request.user.is_authenticated:
            context["pending_friend_requests"] = []
            context["pending_requests_count"] = 0
        
        return render(request, 'routes/my_routes.html', context)


@login_required
def shared_routes(request):
    # Все в одном запросе с Q объектами
    routes = Route.objects.filter(
        Q(shared_with=request.user) | Q(privacy="link"),
        is_active=True
    ).exclude(author=request.user).prefetch_related('photos').distinct()

    user_favorites_ids = []
    if request.user.is_authenticated:
        user_favorites_ids = Favorite.objects.filter(
            user=request.user
        ).values_list("route_id", flat=True)
    
    # Аннотируем средний рейтинг
    routes = routes.annotate(
        rating=Avg("ratings__rating"),
        rating_count=Count("ratings")
    ).order_by("-created_at")

    # Считаем отдельно для контекста
    shared_count = Route.objects.filter(
        shared_with=request.user, is_active=True
    ).exclude(author=request.user).count()
    
    link_count = Route.objects.filter(
        privacy="link", is_active=True
    ).exclude(author=request.user).count()

    context = {
        "routes": routes,
        "shared_count": shared_count,
        "link_count": link_count,
        "user_favorites_ids": list(user_favorites_ids),
    }

    if request.user.is_authenticated:
        context["pending_friend_requests"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5]
        context["pending_requests_count"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count()

    return render(request, "routes/shared_routes.html", context)


def route_detail(request, route_id):
    """Детальная страница маршрута"""
    # Получаем маршрут с базовой оптимизацией
    route = get_object_or_404(
        Route.objects.select_related('author')
        .prefetch_related(
            'photos',
            'shared_with',
        ),
        id=route_id
    )

    # Проверка доступа
    if not can_view_route(request.user, route):
        messages.error(request, "У вас нет доступа к этому маршруту")
        return redirect("home")

    # Получаем точки с фото отдельно
    points = RoutePoint.objects.filter(route=route).prefetch_related('photos').order_by('order')
    
    # Получаем фото маршрута
    route_photos = route.photos.all().order_by("order")
    
    # Получаем комментарии из interactions
    comments = Comment.objects.filter(route=route).select_related('user').order_by('-created_at')[:10]
    
    # Получаем рейтинги из interactions
    ratings = Rating.objects.filter(route=route)
    
    # ДОБАВЛЯЕМ: Получаем информацию об AI аудио
    full_audio_guide = None
    points_with_audio = []

    try:
        from ai_audio.models import RouteAudioGuide
        full_audio_guide = RouteAudioGuide.objects.filter(route=route).first()
        
        # Собираем точки с AI аудио
        for point in points:
            if point.audio_guide:  # Проверяем есть ли аудио файл у точки
                points_with_audio.append(point.id)
    except ImportError:
        # Если приложение ai_audio не установлено
        pass

    # Сообщения чата маршрута
    route_chat_messages = []
    if hasattr(route, "chat"):
        route_chat_messages = (
            route.chat.messages.all()
            .select_related("user")
            .order_by("-timestamp")[:20]
        )

    # Избранное из interactions - ЕДИНАЯ МОДЕЛЬ
    user_favorites_ids = []
    is_favorite = False
    
    if request.user.is_authenticated:
        user_favorites_ids = Favorite.objects.filter(
            user=request.user
        ).values_list("route_id", flat=True)
        
        # Проверяем, является ли текущий маршрут избранным
        is_favorite = route.id in user_favorites_ids

    # Рейтинг пользователя из interactions
    user_rating = None
    if request.user.is_authenticated:
        try:
            user_rating = Rating.objects.get(
                user=request.user, route=route
            ).score
        except Rating.DoesNotExist:
            pass

    # Похожие маршруты
    similar_routes = Route.objects.filter(
        route_type=route.route_type, privacy="public", is_active=True
    ).exclude(id=route.id)[:5]

    context = {
        "route": route,
        "points": points,
        "route_photos": route_photos,
        "comments": comments,
        "ratings": ratings,
        "route_chat_messages": route_chat_messages,
        "user_favorites_ids": list(user_favorites_ids),
        "is_favorite": is_favorite,
        "user_rating": user_rating,
        "similar_routes": similar_routes,
        "full_audio_guide": full_audio_guide,
        "points_with_audio": points_with_audio,
    }

    if request.user.is_authenticated:
        pending_friend_requests = Friendship.objects.filter(
            to_user=request.user, status="pending"
        )
        context["pending_friend_requests"] = pending_friend_requests[:5]
        context["pending_requests_count"] = pending_friend_requests.count()

    return render(request, "routes/route_detail.html", context)


@login_required
@csrf_exempt
def send_to_friend(request, route_id):
    """Отправка маршрута другу"""
    route = get_object_or_404(Route, id=route_id)

    if route.author != request.user and not request.user.is_staff:
        return JsonResponse(
            {
                "success": False,
                "error": "У вас нет прав для отправки этого маршрута",
            }
        )

    try:
        data = json.loads(request.body)
        friend_id = data.get("friend_id")
        message = data.get("message", "")

        if not friend_id:
            return JsonResponse({"success": False, "error": "Не выбран друг"})

        try:
            from users.models import Friendship

            friend = User.objects.get(id=friend_id)

            # Проверяем дружбу
            friendship = Friendship.objects.filter(
                (
                    Q(from_user=request.user, to_user=friend)
                    | Q(from_user=friend, to_user=request.user)
                ),
                status="accepted",
            ).first()

            if not friendship:
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Пользователь не является вашим другом",
                    }
                )

            # Добавляем маршрут в общий доступ
            route.shared_with.add(friend)
            route.save()

            # Создаем уведомление (если есть модель Notification)
            try:
                from notifications.models import Notification

                Notification.objects.create(
                    user=friend,
                    title="Вам отправили маршрут",
                    message=f'{request.user.username} отправил(а) вам маршрут "{route.name}"',
                    notification_type="route_shared",
                    related_object_id=route.id,
                    related_object_type="route",
                )
            except ImportError:
                # Модель уведомлений не найдена - пропускаем
                pass

            friend_name = friend.first_name or friend.username

            return JsonResponse(
                {
                    "success": True,
                    "message": f'Маршрут "{route.name}" отправлен другу {friend_name}',
                }
            )

        except User.DoesNotExist:
            return JsonResponse({"success": False, "error": "Друг не найден"})

    except json.JSONDecodeError:
        return JsonResponse(
            {"success": False, "error": "Неверный формат данных"}
        )
    except Exception as e:
        return JsonResponse(
            {"success": False, "error": f"Ошибка отправки: {str(e)}"}
        )


@login_required
def create_route(request):
    """Создание нового маршрута"""
    if request.method == "POST":
        try:
            data = json.loads(request.body)

            # Валидация обязательных полей
            if not data.get("name"):
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Название маршрута обязательно",
                    }
                )

            if not data.get("waypoints"):
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Добавьте хотя бы одну точку маршрута",
                    }
                )

            # Создаем маршрут
            route = Route.objects.create(
                author=request.user,
                name=data.get("name"),
                description=data.get("description", ""),
                short_description=data.get("short_description", ""),
                privacy=data.get("privacy", "public"),
                route_type=data.get("route_type", "walking"),
                duration_minutes=data.get("duration_minutes", 0),
                total_distance=data.get("total_distance", 0),
                has_audio_guide=data.get("has_audio_guide", False),
                is_elderly_friendly=data.get("is_elderly_friendly", False),
            )

            # Добавляем фото маршрута
            route_photos = data.get("route_photos", [])
            for i, photo_data in enumerate(route_photos):
                if photo_data:
                    try:
                        # Поддерживаем разные форматы: строка (data:/media) или объект {url, caption}
                        if isinstance(photo_data, dict):
                            photo_url = photo_data.get('url', '')
                            caption = photo_data.get('caption', '')
                            if photo_url and isinstance(photo_url, str) and photo_url.startswith('data:'):
                                photo = save_base64_photo(photo_url, route, RoutePhoto, order=i, caption=caption)
                            elif photo_url and isinstance(photo_url, str) and (photo_url.startswith('/uploads/') or photo_url.startswith('/media/')):
                                photo = copy_existing_photo(photo_url, route, RoutePhoto, order=i, caption=caption)
                        else:
                            # Проверяем формат фото (строка)
                            if isinstance(photo_data, str) and photo_data.startswith('data:'):
                                photo = save_base64_photo(photo_data, route, RoutePhoto, order=i)
                            elif isinstance(photo_data, str) and (photo_data.startswith('/uploads/') or photo_data.startswith('/media/')):
                                photo = copy_existing_photo(photo_data, route, RoutePhoto, order=i)
                    except Exception as e:
                        print(f"Ошибка сохранения фото маршрута: {e}")
                        continue

            # Добавляем точки
            points_data = data.get("waypoints", [])
            for i, point_data in enumerate(points_data):
                point = RoutePoint.objects.create(
                    route=route,
                    name=point_data.get("name", f"Точка {i+1}"),
                    description=point_data.get("description", ""),
                    address=point_data.get("address", ""),
                    latitude=point_data.get("lat", 0),
                    longitude=point_data.get("lng", 0),
                    category=point_data.get("category", ""),
                    order=i,
                )

                # Добавляем фото точки если есть
                point_photos = point_data.get("photos", [])
                for j, photo_data in enumerate(point_photos):
                    if photo_data:
                        try:
                            # Поддерживаем объекты {url, caption} и строки
                            if isinstance(photo_data, dict):
                                photo_url = photo_data.get('url', '')
                                caption = photo_data.get('caption', '')
                                if photo_url and isinstance(photo_url, str) and photo_url.startswith('data:'):
                                    save_base64_photo(photo_url, point, PointPhoto, order=j, caption=caption)
                                elif photo_url and isinstance(photo_url, str) and (photo_url.startswith('/uploads/') or photo_url.startswith('/media/')):
                                    copy_existing_photo(photo_url, point, PointPhoto, order=j, caption=caption)
                            else:
                                if isinstance(photo_data, str) and photo_data.startswith('data:'):
                                    save_base64_photo(photo_data, point, PointPhoto, order=j)
                                elif isinstance(photo_data, str) and (photo_data.startswith('/uploads/') or photo_data.startswith('/media/')):
                                    copy_existing_photo(photo_data, point, PointPhoto, order=j)
                        except Exception as e:
                            print(f"Ошибка сохранения фото точки: {e}")
                            continue

            return JsonResponse({"success": True, "route_id": route.id})

        except json.JSONDecodeError:
            return JsonResponse(
                {"success": False, "error": "Неверный формат JSON"}
            )
        except KeyError as e:
            return JsonResponse(
                {
                    "success": False,
                    "error": f"Отсутствует обязательное поле: {str(e)}",
                }
            )
        except Exception as e:
            return JsonResponse(
                {"success": False, "error": f"Ошибка сервера: {str(e)}"}
            )

    # GET запрос - показать форму
    context = {
        "pending_friend_requests": Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5],
        "pending_requests_count": Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count(),
    }
    return render(request, "routes/route_editor.html", context)


def edit_route(request, route_id):
    """Редактирование маршрута"""
    route = get_object_or_404(Route, id=route_id, author=request.user)

    if request.method == "POST":
        try:
            data = json.loads(request.body)
            print("="*80)
            print("=== РЕДАКТИРОВАНИЕ МАРШРУТА ===")
            print("="*80)
            print("📝 Маршрут:", data.get("name"))
            print("📍 Количество точек:", len(data.get("points", [])))
            print("📷 Фото маршрута в данных:", len(data.get("route_photos", [])))
            # === ВАЖНО: Считаем фото точек ===
            total_point_photos = 0
            for i, point in enumerate(data.get("points", [])):
                point_photos = point.get("photos", [])
                print(f"📍 Точка {i+1} '{point.get('name')}': {len(point_photos)} фото")
                total_point_photos += len(point_photos)
            print(f"📊 ИТОГО: {total_point_photos} фото точек, {len(data.get('route_photos', []))} фото маршрута")
            print("="*80)

            # Обновляем основные поля маршрута
            route.name = data.get("name", route.name)
            route.description = data.get("description", route.description)
            route.short_description = data.get("short_description", route.short_description)
            route.privacy = data.get("privacy", route.privacy)
            route.route_type = data.get("route_type", route.route_type)
            route.duration_minutes = data.get("duration_minutes", route.duration_minutes)
            route.total_distance = data.get("total_distance", route.total_distance)
            route.has_audio_guide = data.get("has_audio_guide", route.has_audio_guide)
            route.is_elderly_friendly = data.get("is_elderly_friendly", route.is_elderly_friendly)
            route.is_active = data.get("is_active", route.is_active)
            route.duration_display = data.get("duration_display", route.duration_display)
            route.save()

            # === ОБРАБОТКА ФОТО МАРШРУТА ===
            removed_photo_ids = data.get("removed_photo_ids", [])
            for photo_id in removed_photo_ids:
                try:
                    photo = RoutePhoto.objects.get(id=photo_id, route=route)
                    photo.delete()
                    print(f"🗑️ Удалено фото ID: {photo_id}")
                except RoutePhoto.DoesNotExist:
                    pass

            # === ОБРАБОТКА ТОЧЕК (БЕЗ УДАЛЕНИЯ ВСЕХ!) ===
            points_data = data.get("points", [])
            incoming_point_ids = []

            for i, point_data in enumerate(points_data):
                point_id = point_data.get("id")
                if point_id:
                    # Обновляем существующую точку
                    try:
                        point = RoutePoint.objects.get(id=point_id, route=route)
                        point.name = point_data.get("name", f"Точка {i+1}")
                        point.description = point_data.get("description", "")
                        point.address = point_data.get("address", "")
                        point.latitude = point_data.get("lat", point.latitude)
                        point.longitude = point_data.get("lng", point.longitude)
                        point.category = point_data.get("category", "")
                        point.order = i
                        point.save()
                        incoming_point_ids.append(point_id)
                    except RoutePoint.DoesNotExist:
                        # Создаём новую, если не найдена
                        point = RoutePoint.objects.create(
                            route=route,
                            name=point_data.get("name", f"Точка {i+1}"),
                            description=point_data.get("description", ""),
                            address=point_data.get("address", ""),
                            latitude=point_data.get("lat", 0),
                            longitude=point_data.get("lng", 0),
                            category=point_data.get("category", ""),
                            order=i,
                        )
                        incoming_point_ids.append(point.id)
                else:
                    # Создаём новую точку
                    point = RoutePoint.objects.create(
                        route=route,
                        name=point_data.get("name", f"Точка {i+1}"),
                        description=point_data.get("description", ""),
                        address=point_data.get("address", ""),
                        latitude=point_data.get("lat", 0),
                        longitude=point_data.get("lng", 0),
                        category=point_data.get("category", ""),
                        order=i,
                    )
                    incoming_point_ids.append(point.id)

            # Удаляем ТОЛЬКО те точки, которых нет во входящих данных
            RoutePoint.objects.filter(route=route).exclude(id__in=incoming_point_ids).delete()

            # === ОБРАБОТКА ФОТО ТОЧЕК ===
            for point_data in points_data:
                point_id = point_data.get("id")
                if not point_id:
                    continue
                try:
                    point = RoutePoint.objects.get(id=point_id, route=route)
                except RoutePoint.DoesNotExist:
                    continue

                point_photos_data = point_data.get("photos")

                if point_photos_data is not None and isinstance(point_photos_data, list):
                    print(f"  📸 Фронтенд прислал {len(point_photos_data)} фото для точки {point.id}")
                    
                    # Получаем существующие фото
                    existing_photos = list(point.photos.all().order_by('order'))
                    
                    # Создаем словарь существующих фото по их URL
                    existing_photos_dict = {}
                    for photo in existing_photos:
                        if photo.image:
                            existing_photos_dict[photo.image.url] = photo
                    
                    # Создаем множество входящих фото URL
                    incoming_photo_urls = set()
                    for photo_data in point_photos_data:
                        if isinstance(photo_data, dict):
                            url = photo_data.get('url', '')
                        else:
                            url = str(photo_data)
                        if url.startswith('/media/') or url.startswith('/uploads/'):
                            incoming_photo_urls.add(url)
                    
                    # Удаляем только те фото, которых нет во входящих данных
                    photos_to_delete = []
                    for photo_url, photo in existing_photos_dict.items():
                        if photo_url not in incoming_photo_urls:
                            photos_to_delete.append(photo.id)
                    
                    if photos_to_delete:
                        PointPhoto.objects.filter(id__in=photos_to_delete).delete()
                        print(f"    🗑️ Удалено {len(photos_to_delete)} фото")
                    
                    # Добавляем новые фото
                    for j, photo_data in enumerate(point_photos_data):
                        if not photo_data:
                            continue
                            
                        try:
                            # Проверяем, существует ли уже это фото
                            photo_url = ''
                            caption = ''
                            
                            if isinstance(photo_data, dict):
                                photo_url = photo_data.get("url", "")
                                caption = photo_data.get("caption", "")
                            elif isinstance(photo_data, str):
                                photo_url = photo_data
                            
                            # Пропускаем если это DataURL (новое фото) или если фото уже существует
                            if photo_url.startswith("data:"):
                                # Это новое фото в формате base64
                                photo = save_base64_photo(photo_url, point, PointPhoto, order=j, caption=caption)
                                if photo:
                                    print(f"    ✅ Добавлено новое фото из base64")
                            elif photo_url and (photo_url.startswith("/media/") or photo_url.startswith("/uploads/")):
                                # Это ссылка на существующее фото
                                # Проверяем, есть ли уже такое фото у точки
                                existing = point.photos.filter(image__url=photo_url).first()
                                if not existing:
                                    # Копируем только если фото еще нет у точки
                                    photo = copy_existing_photo(photo_url, point, PointPhoto, order=j, caption=caption)
                                    if photo:
                                        print(f"    ✅ Скопировано существующее фото")
                                else:
                                    # Обновляем существующее фото
                                    existing.order = j
                                    if caption:
                                        existing.caption = caption
                                    existing.save()
                                    print(f"    🔄 Обновлено существующее фото ID {existing.id}")
                                    
                        except Exception as e:
                            print(f"    ❌ Ошибка при сохранении фото точки {point.id}: {e}")
                            continue
                else:
                    print(f"  ℹ️ Фото для точки {point.id} не присланы → оставляем как есть")

            print("=== УСПЕШНО СОХРАНЕНО ===")
            return JsonResponse({"success": True, "route_id": route.id})
            
        except Exception as e:
            print(f"=== ОШИБКА ПРИ РЕДАКТИРОВАНИИ ===")
            print(f"Ошибка: {str(e)}")
            import traceback
            print(f"Traceback: {traceback.format_exc()}")
            return JsonResponse({"success": False, "error": str(e)})

    # ============ ОБРАБОТКА GET ЗАПРОСА ============
    print("=== ПОДГОТОВКА ДАННЫХ ДЛЯ РЕДАКТОРА МАРШРУТА ===")
    print(f"Загрузка маршрута {route.id}: {route.name}")
    
    # Основные данные маршрута
    route_data = {
        "id": route.id,
        "name": route.name,
        "description": route.description,
        "short_description": route.short_description,
        "privacy": route.privacy,
        "route_type": route.route_type,
        "duration_minutes": route.duration_minutes,
        "total_distance": route.total_distance,
        "has_audio_guide": route.has_audio_guide,
        "is_elderly_friendly": route.is_elderly_friendly,
        "is_active": route.is_active,
        "duration_display": route.duration_display,
        "route_photos": [],
        "points": []
    }

    # Загружаем фото маршрута
    route_photos = route.photos.all().order_by("order")
    print(f"Фото маршрута: {route_photos.count()} шт.")
    
    for photo in route_photos:
        photo_data = {
            "id": photo.id,
            "url": photo.image.url if photo.image else "",
            "caption": photo.caption or "",
            "order": photo.order
        }
        route_data["route_photos"].append(photo_data)
        print(f"  Фото ID {photo.id}: {photo.image.url if photo.image else 'нет URL'}")

    # Загружаем точки
    points = route.points.all().order_by("order")
    print(f"Точек маршрута: {points.count()} шт.")
    
    for point in points:
        point_data = {
            "id": point.id,
            "name": point.name,
            "description": point.description or "",
            "address": point.address or "",
            "lat": float(point.latitude) if point.latitude else 0,
            "lng": float(point.longitude) if point.longitude else 0,
            "category": point.category or "",
            "photos": []
        }
        
        # Загружаем фото точки
        point_photos = point.photos.all().order_by("order")
        for photo in point_photos:
            point_data["photos"].append({
                "id": photo.id,
                "url": photo.image.url if photo.image else "",
                "caption": photo.caption or "",
                "order": photo.order
            })
        
        route_data["points"].append(point_data)

    print("=== ДАННЫЕ ПОДГОТОВЛЕНЫ ===")
    
    context = {
        "route": route,
        "route_data_json": json.dumps(route_data),
        "pending_friend_requests": Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5],
        "pending_requests_count": Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count(),
    }
    
    return render(request, "routes/route_editor.html", context)


def save_base64_photo(photo_data, parent_obj, photo_model, order=0, caption=""):
    """Сохранение фото из base64 DataURL с четким разделением типов"""
    try:
        print(f"=== DEBUG SAVE BASE64 PHOTO ===")
        print(f"🔧 Сохранение фото для {photo_model.__name__}")
        print(f"📷 Родительский объект: {parent_obj.__class__.__name__} ID: {parent_obj.id}")
        print(f"📝 Caption: {caption}")
        print(f"📊 Order: {order}")

        if not photo_data:
            print("❌ Нет данных photo_data")
            return None

        # Проверяем что это DataURL
        if not isinstance(photo_data, str):
            print(f"❌ Не строка: {type(photo_data)}")
            return None
            
        if not photo_data.startswith("data:"):
            print(f"❌ Это не DataURL: {photo_data[:50]}...")
            return None

        if ";base64," not in photo_data:
            print("❌ Неправильный формат DataURL")
            return None

        # Разделяем на части
        header, data = photo_data.split(";base64,", 1)

        # Определяем расширение файла из MIME type
        mime_type = header.replace("data:", "")
        extensions = {
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/png": ".png",
            "image/gif": ".gif",
            "image/webp": ".webp",
            "image/bmp": ".bmp",
        }

        ext = extensions.get(mime_type, ".jpg")

        # Декодируем base64
        try:
            image_data = base64.b64decode(data)
            print(f"✅ Base64 декодирован, размер: {len(image_data)} байт")
        except Exception as e:
            print(f"❌ Ошибка декодирования base64: {e}")
            return None

        # Создаем уникальное имя файла с указанием типа
        timestamp = int(timezone.now().timestamp())
        parent_type = parent_obj.__class__.__name__.lower()
        
        if photo_model.__name__ == "RoutePhoto":
            prefix = "route"
        elif photo_model.__name__ == "PointPhoto":
            prefix = "point"
        else:
            prefix = "photo"
            
        filename = f"{prefix}_{parent_type}_{parent_obj.id}_{timestamp}_{order}{ext}"

        print(f"📁 Имя файла: {filename}")
        print(f"📁 MIME type: {mime_type}")

        # Создаем объект фото
        if photo_model == RoutePhoto:
            photo = RoutePhoto.objects.create(
                route=parent_obj,
                order=order, 
                caption=caption,
                is_main=False  # Явно указываем, что это не главное фото
            )
        elif photo_model == PointPhoto:
            photo = PointPhoto.objects.create(
                point=parent_obj,
                order=order, 
                caption=caption
            )
        else:
            print(f"❌ Неизвестная модель фото: {photo_model}")
            return None

        print(f"📸 Создан объект фото: {photo.id}")

        # Сохраняем изображение
        photo.image.save(filename, ContentFile(image_data), save=True)

        print(f"✅ Фото сохранено успешно!")
        print(f"📁 Путь: {photo.image.path}")
        print(f"🌐 URL: {photo.image.url}")
        print(f"=== END DEBUG SAVE PHOTO ===")

        return photo

    except Exception as e:
        print(f"❌ КРИТИЧЕСКАЯ ОШИБКА сохранения фото: {e}")
        import traceback
        print(f"🔍 Traceback: {traceback.format_exc()}")
        return None


def copy_existing_photo(photo_url, parent_obj, photo_model, order=0, caption=""):
    """Копирование существующего фото БЕЗ удаления оригинала"""
    try:
        print(f"=== DEBUG COPY EXISTING PHOTO ===")
        print(f"🔧 Копирование фото: {photo_url}")
        print(f"📷 Модель: {photo_model.__name__}")
        print(f"📝 Caption: {caption}")

        if photo_url.startswith("/media/"):
            media_path = photo_url.replace("/media/", "", 1)
        elif photo_url.startswith("/uploads/"):
            media_path = photo_url.replace("/uploads/", "", 1)
        else:
            print(f"❌ Неверный URL фото: {photo_url}")
            return None

        # Получаем абсолютный путь к файлу
        full_path = Path(settings.MEDIA_ROOT) / media_path

        if not full_path.exists():
            print(f"❌ Файл не найден: {full_path}")
            return None

        # Читаем файл (копируем, не удаляем!)
        with open(full_path, "rb") as f:
            file_data = f.read()

        # Создаем уникальное имя для копии
        import uuid
        from django.utils import timezone
        timestamp = int(timezone.now().timestamp())
        random_str = str(uuid.uuid4())[:8]
        
        # Определяем расширение
        ext = full_path.suffix
        if not ext:
            ext = ".jpg"
        
        parent_type = parent_obj.__class__.__name__.lower()
        prefix = "point" if photo_model.__name__ == "PointPhoto" else "route"
        
        # Создаем уникальное имя файла для копии
        filename = f"{prefix}_{parent_type}_{parent_obj.id}_{timestamp}_{random_str}{ext}"

        # Создаем объект фото
        if photo_model == RoutePhoto:
            photo = RoutePhoto.objects.create(
                route=parent_obj, 
                order=order, 
                caption=caption, 
                is_main=False
            )
        elif photo_model == PointPhoto:
            photo = PointPhoto.objects.create(
                point=parent_obj, 
                order=order, 
                caption=caption
            )
        else:
            print(f"❌ Неизвестная модель фото: {photo_model}")
            return None

        # Сохраняем копию файла (оригинал остается нетронутым)
        photo.image.save(filename, ContentFile(file_data), save=True)
        print(f"✅ Фото скопировано успешно! Новый URL: {photo.image.url} (оригинал сохранен)")
        return photo

    except Exception as e:
        print(f"❌ Ошибка копирования фото: {e}")
        traceback.print_exc()
        return None


@require_POST
def delete_route(request, route_id):
    """Удаление маршрута со всеми связанными данными"""
    try:
        route = get_object_or_404(Route, id=route_id, user=request.user)
        
        data = json.loads(request.body)
        delete_all_data = data.get('delete_all_data', True)
        clear_cache = data.get('clear_cache', True)
        
        # Удаляем фото маршрута
        if delete_all_data:
            for photo in route.photos.all():
                # Удаляем файл из медиа
                if photo.image and photo.image.name:
                    photo_path = os.path.join(settings.MEDIA_ROOT, photo.image.name)
                    if os.path.exists(photo_path):
                        os.remove(photo_path)
        
        # Удаляем фото точек
        for point in route.points.all():
            if delete_all_data:
                for photo in point.photos.all():
                    if photo.image and photo.image.name:
                        photo_path = os.path.join(settings.MEDIA_ROOT, photo.image.name)
                        if os.path.exists(photo_path):
                            os.remove(photo_path)
        
        # Удаляем аудиофайлы
        if hasattr(route, 'audio_guides'):
            for audio in route.audio_guides.all():
                if delete_all_data and audio.audio_file and audio.audio_file.name:
                    audio_path = os.path.join(settings.MEDIA_ROOT, audio.audio_file.name)
                    if os.path.exists(audio_path):
                        os.remove(audio_path)
        
        # Очищаем кеш маршрута
        if clear_cache:
            cache_keys = [
                f'route_{route_id}',
                f'route_{route_id}_points',
                f'route_{route_id}_photos',
                f'route_{route_id}_audio',
            ]
            for key in cache_keys:
                cache.delete(key)
            
            # Очищаем кеш для связанных карт
            cache.delete_pattern(f'*route_{route_id}*')
        
        # Удаляем сам маршрут (каскадно удалятся все связанные объекты)
        route.delete()
        
        return JsonResponse({
            'success': True,
            'message': 'Маршрут успешно удален'
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=400)

@login_required
def toggle_route_active(request, route_id):
    """Включение/выключение маршрута"""
    route = get_object_or_404(Route, id=route_id, author=request.user)
    route.is_active = not route.is_active
    route.last_status_update = timezone.now()
    route.save()

    messages.success(
        request,
        f'Маршрут {"активирован" if route.is_active else "деактивирован"}',
    )
    return redirect("route_detail", route_id=route_id)


@login_required
@csrf_exempt
def rate_route(request, route_id):
    """Оценка маршрута"""
    if request.method == "POST":
        route = get_object_or_404(Route, id=route_id)
        data = json.loads(request.body)
        rating_value = data.get("rating")

        if not (1 <= rating_value <= 5):
            return JsonResponse(
                {"success": False, "error": "Рейтинг должен быть от 1 до 5"}
            )

        rating, created = RouteRating.objects.get_or_create(
            route=route, user=request.user, defaults={"rating": rating_value}
        )

        if not created:
            rating.rating = rating_value
            rating.save()

        return JsonResponse(
            {"success": True, "average_rating": route.get_average_rating()}
        )

    return JsonResponse({"success": False, "error": "Only POST allowed"})


@login_required
@csrf_exempt
def toggle_favorite(request, route_id):
    """Добавление/удаление из избранного"""
    route = get_object_or_404(Route, id=route_id)

    if request.method == "POST":
        favorite, created = RouteFavorite.objects.get_or_create(
            route=route, user=request.user
        )

        if not created:
            favorite.delete()
            return JsonResponse({"success": True, "is_favorite": False})

        return JsonResponse({"success": True, "is_favorite": True})

    return JsonResponse({"success": False, "error": "Only POST allowed"})


@login_required
def add_route_comment(request, route_id):
    """Добавление комментария к маршруту"""
    route = get_object_or_404(Route, id=route_id)

    if request.method == "POST":
        text = request.POST.get("text")
        if text:
            RouteComment.objects.create(
                route=route, user=request.user, text=text
            )
            messages.success(request, "Комментарий добавлен")

    return redirect("route_detail", route_id=route_id)


@login_required
def add_point_comment(request, point_id):
    """Добавление комментария к точке"""
    point = get_object_or_404(RoutePoint, id=point_id)

    if request.method == "POST":
        text = request.POST.get("text")
        if text:
            PointComment.objects.create(
                point=point, user=request.user, text=text
            )
            messages.success(request, "Комментарий добавлен")

    return redirect("route_detail", route_id=point.route.id)


def map_view(request):
    routes = (
        Route.objects.filter(privacy="public", is_active=True)
        .prefetch_related("points", "photos")
        .annotate(avg_rating=Avg("ratings__rating"))
    )

    routes_data = []
    for route in routes:
        route_data = {
            "id": route.id,
            "title": route.name,
            "short_description": route.short_description,
            "description": route.description,
            "distance": route.total_distance,
            "rating": route.avg_rating or 0,
            "has_audio": route.has_audio_guide,
            "difficulty": route.route_type,
            "photos": [
                {"url": photo.image.url, "caption": photo.caption}
                for photo in route.photos.all()[:3]
            ],
            "points": [
                {
                    "lat": p.latitude,
                    "lng": p.longitude,
                    "name": p.name,
                    "address": p.address,
                    "description": p.description,
                    "order": p.order,
                }
                for p in route.points.all()
            ],
        }
        routes_data.append(route_data)

    routes_json = json.dumps(routes_data, ensure_ascii=False)

    return render(
        request,
        "map/map_view.html",
        {"routes_json": routes_json, "routes": routes},
    )


def can_view_route(user, route):
    """Проверка доступа к маршруту"""
    if route.privacy == "public":
        return True
    if not user.is_authenticated:
        return False
    if route.privacy == "private" and route.author == user:
        return True
    if route.privacy == "personal" and (
        route.author == user or user in route.shared_with.all()
    ):
        return True
    if route.privacy == "link":
        return True
    return False


@login_required
@require_http_methods(["POST"])
def share_route(request, route_id):
    from django.contrib.auth import get_user_model

    User = get_user_model()

    try:
        route = Route.objects.get(id=route_id, author=request.user)
    except Route.DoesNotExist:
        return JsonResponse(
            {"success": False, "error": "Маршрут не найден или вы не автор"},
            status=403,
        )

    try:
        data = json.loads(request.body)
        email = data.get("email", "").strip()
    except (json.JSONDecodeError, ValueError):
        return JsonResponse(
            {"success": False, "error": "Некорректный формат данных"},
            status=400,
        )

    if not email:
        return JsonResponse(
            {"success": False, "error": "Email не указан"}, status=400
        )

    try:
        target_user = User.objects.get(email=email)
    except User.DoesNotExist:
        return JsonResponse(
            {
                "success": False,
                "error": "Пользователь с таким email не зарегистрирован",
            },
            status=404,
        )

    if target_user == request.user:
        return JsonResponse(
            {
                "success": False,
                "error": "Нельзя предоставить доступ самому себе",
            },
            status=400,
        )

    route.privacy = "personal"
    route.shared_with.add(target_user)
    route.save()

    return JsonResponse(
        {
            "success": True,
            "message": f"Доступ к маршруту «{route.name}» предоставлен пользователю {email}",
        }
    )


def get_user_rating(user, route):
    """Получение оценки пользователя для маршрута"""
    if not user.is_authenticated:
        return None
    try:
        rating = RouteRating.objects.get(user=user, route=route)
        return rating.rating
    except RouteRating.DoesNotExist:
        return None


def haversine_distance(lat1, lon1, lat2, lon2):
    """Расчет расстояния между двумя точками"""
    R = 6371  # Радиус Земли в км
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def walking_routes(request):
    """Страница с пешими маршрутами"""
    routes = Route.objects.filter(route_type="walking", is_active=True).prefetch_related('photos')

    context = {
        "routes": routes,
        "page_title": "Пешие маршруты",
        "route_type": "walking",
        "total_count": routes.count(),
    }
    return render(request, "routes/filtered_routes.html", context)

def driving_routes(request):
    """Страница с автомобильными маршрутами"""
    routes = Route.objects.filter(route_type="driving", is_active=True).prefetch_related('photos')

    user_favorites_ids = []
    if request.user.is_authenticated:
        user_favorites_ids = Favorite.objects.filter(
            user=request.user
        ).values_list("route_id", flat=True)

    context = {
        "routes": routes,
        "page_title": "Автомобильные маршруты",
        "route_type": "driving",
        "total_count": routes.count(),
        "user_favorites_ids": list(user_favorites_ids),
    }
    return render(request, "routes/filtered_routes.html", context)

def cycling_routes(request):
    """Страница с велосипедными маршрутами"""
    routes = Route.objects.filter(route_type="cycling", is_active=True).prefetch_related('photos')

    user_favorites_ids = []
    if request.user.is_authenticated:
        user_favorites_ids = Favorite.objects.filter(
            user=request.user
        ).values_list("route_id", flat=True)

    context = {
        "routes": routes,
        "page_title": "Велосипедные маршруты",
        "route_type": "cycling",
        "total_count": routes.count(),
        "user_favorites_ids": list(user_favorites_ids),
    }
    return render(request, "routes/filtered_routes.html", context)

def adventure_routes(request):
    """Страница с приключенческими маршрутами"""
    routes = Route.objects.filter(is_active=True).prefetch_related('photos')

    user_favorites_ids = []
    if request.user.is_authenticated:
        user_favorites_ids = Favorite.objects.filter(
            user=request.user
        ).values_list("route_id", flat=True)

    context = {
        "routes": routes,
        "page_title": "Приключенческие маршруты",
        "total_count": routes.count(),
        "user_favorites_ids": list(user_favorites_ids),
    }
    return render(request, "routes/filtered_routes.html", context)


def search_routes(request):
    """Отдельная view для поиска"""
    query = request.GET.get("q", "")
    route_type = request.GET.get("type", "")

    routes = Route.objects.filter(is_active=True)

    if query:
        routes = routes.filter(
            Q(name__icontains=query)
            | Q(description__icontains=query)
            | Q(country__icontains=query)
        )

    if route_type:
        routes = routes.filter(route_type=route_type)

    user_favorites_ids = []
    if request.user.is_authenticated:
        user_favorites_ids = Favorite.objects.filter(
            user=request.user
        ).values_list("route_id", flat=True)

    context = {
        "routes": routes,
        "query": query,
        "route_type": route_type,
        "total_count": routes.count(),
        "user_favorites_ids": list(user_favorites_ids),
    }
    return render(request, "routes/search_results.html", context)


class RouteCreateView(LoginRequiredMixin, View):
    def post(self, request):
        try:
            # КРИТИЧНО: Кэшируем body ОДИН РАЗ в начале
            try:
                cached_body = request.body
                if isinstance(cached_body, bytes):
                    cached_body = cached_body.decode('utf-8')
            except Exception as e:
                print(f"❌ Ошибка при кэшировании body: {e}")
                return JsonResponse({"success": False, "error": "Ошибка при чтении данных запроса"})
            
            data = {}
            point_photo_files = {}
            
            # Проверяем формат данных
            content_type = request.META.get('CONTENT_TYPE', '')
            print(f"📋 Content-Type: {content_type}")
            
            if 'application/json' in content_type:
                # JSON формат - используем кэшированный body
                try:
                    data = json.loads(cached_body)
                    print("📝 Получены данные в формате JSON для создания маршрута")
                except Exception as e:
                    print(f"❌ Ошибка при парсинге JSON: {e}")
                    return JsonResponse({"success": False, "error": f"Ошибка при чтении JSON: {str(e)}"})
            else:
                # FormData формат
                try:
                    # Парсим route_data из POST
                    route_data_str = request.POST.get('route_data', '{}')
                    data = json.loads(route_data_str)
                    print("📁 Получены данные в FormData для создания маршрута")
                    print(f"POST ключи: {list(request.POST.keys())}")
                    print(f"FILES ключи: {list(request.FILES.keys())}")
                except Exception as e:
                    print(f"❌ Ошибка парсинга FormData: {e}")
                    return JsonResponse({"success": False, "error": f"Ошибка при обработке FormData: {str(e)}"})
                
                # Извлекаем файлы фото точек из FILES
                for key, file in request.FILES.items():
                    print(f"  📷 Файл: {key} - {file.name} ({file.size} байт)")
                    point_photo_files[key] = file

            # Валидация обязательных полей
            if not data.get("name"):
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Название маршрута обязательно",
                    }
                )

            if not data.get("waypoints") or len(data.get("waypoints", [])) < 2:
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Добавьте хотя бы две точки маршрута",
                    }
                )

            route = Route.objects.create(
                author=request.user,
                name=data.get("name"),
                description=data.get("description", ""),
                short_description=data.get("short_description", ""),
                privacy=data.get("privacy", "public"),
                route_type=data.get("route_type", "walking"),
                duration_minutes=data.get("duration_minutes", 0),
                total_distance=data.get("total_distance", 0),
                has_audio_guide=data.get("has_audio_guide", False),
                is_elderly_friendly=data.get("is_elderly_friendly", False),
                duration_display=data.get("duration_display", ""),
            )

            # Добавляем фото маршрута
            route_photos = data.get("route_photos", [])
            for i, photo_data in enumerate(route_photos):
                if photo_data:
                    try:
                        if photo_data.startswith("data:"):
                            save_base64_photo(
                                photo_data, route, RoutePhoto, order=i
                            )
                        elif photo_data.startswith(
                            "/uploads/"
                        ) or photo_data.startswith("/media/"):
                            copy_existing_photo(
                                photo_data, route, RoutePhoto, order=i
                            )
                    except Exception as e:
                        print(f"Ошибка сохранения фото маршрута: {e}")
                        continue

            # Добавляем точки
            waypoints_data = data.get("waypoints", [])
            for i, point_data in enumerate(waypoints_data):
                point = RoutePoint.objects.create(
                    route=route,
                    name=point_data.get("name", f"Точка {i+1}"),
                    description=point_data.get("description", ""),
                    address=point_data.get("address", ""),
                    latitude=point_data.get("lat", 0),
                    longitude=point_data.get("lng", 0),
                    category=point_data.get("category", ""),
                    order=i,
                )

                # Обрабатываем загруженные файлы фото точки (из FormData)
                main_photo_key = f"point_{i}_main_photo"
                if main_photo_key in point_photo_files:
                    file_obj = point_photo_files[main_photo_key]
                    save_base64_photo(file_obj, point, PointPhoto, order=0)
                    print(f"  ✅ Добавлено основное фото из файла: {file_obj.name}")
                
                # Дополнительные фото из файлов
                additional_counter = 0
                while True:
                    additional_key = f"point_{i}_additional_{additional_counter}"
                    if additional_key not in point_photo_files:
                        break
                    file_obj = point_photo_files[additional_key]
                    save_base64_photo(file_obj, point, PointPhoto, order=additional_counter + 1)
                    print(f"  ✅ Добавлено доп. фото {additional_counter} из файла: {file_obj.name}")
                    additional_counter += 1

                # Добавляем фото точки из JSON (URLs и data-urls)
                point_photos = point_data.get("photos", [])
                for j, photo_data in enumerate(point_photos):
                    if photo_data:
                        try:
                            if isinstance(photo_data, str) and photo_data.startswith("data:"):
                                save_base64_photo(
                                    photo_data, point, PointPhoto, order=j + additional_counter
                                )
                            elif isinstance(photo_data, str) and (photo_data.startswith(
                                "/uploads/"
                            ) or photo_data.startswith("/media/")):
                                copy_existing_photo(
                                    photo_data, point, PointPhoto, order=j + additional_counter
                                )
                        except Exception as e:
                            print(f"Ошибка сохранения фото точки: {e}")
                            continue

            return JsonResponse(
                {"success": True, "route_id": route.id, "id": route.id}
            )

        except json.JSONDecodeError:
            return JsonResponse(
                {"success": False, "error": "Неверный формат JSON"}
            )
        except KeyError as e:
            return JsonResponse(
                {
                    "success": False,
                    "error": f"Отсутствует обязательное поле: {str(e)}",
                }
            )
        except Exception as e:
            return JsonResponse(
                {"success": False, "error": f"Ошибка сервера: {str(e)}"}
            )


class RouteUpdateView(LoginRequiredMixin, View):
    def put(self, request, pk):
        try:
            route = get_object_or_404(Route, id=pk, author=request.user)
            
            # Проверяем формат данных - JSON или FormData
            content_type = request.content_type or ''
            print(f"🔍 content_type: {repr(content_type)}")
            
            if 'application/json' in content_type:
                # JSON формат
                print(f"  → JSON format detected")
                data = json.loads(request.body)
            else:
                # FormData формат
                print(f"  → FormData format detected")
                print(f"  POST.keys(): {list(request.POST.keys())}")
                print(f"  FILES.keys(): {list(request.FILES.keys())}")
                
                # Преобразуем POST в словарь
                data = request.POST.dict()
                
                # DEBUG: Показываем все значения из POST
                print(f"  POST values:")
                for key, value in request.POST.items():
                    value_str = str(value)[:100] if isinstance(value, str) else str(value)
                    print(f"    {key}: {value_str}")
                
                # Добавляем файлы
                if 'main_photo' in request.FILES:
                    data['main_photo'] = request.FILES['main_photo']
                
                # Добавляем остальные файлы фото
                for key in request.FILES:
                    if key.startswith('additional_photos_'):
                        data[key] = request.FILES[key]
                
                # Парсим JSON поля если они есть
                if 'photos_data' in data:
                    print(f"  ✅ photos_data найдена в POST: {data['photos_data'][:100]}...")
                    try:
                        data['photos_data'] = json.loads(data['photos_data'])
                    except (json.JSONDecodeError, TypeError) as e:
                        print(f"  ❌ Ошибка парсинга photos_data: {e}")
                else:
                    print(f"  ❌ photos_data НЕ найдена в POST")
                
                if 'removed_photo_ids' in data:
                    try:
                        data['removed_photo_ids'] = json.loads(data['removed_photo_ids'])
                    except (json.JSONDecodeError, TypeError):
                        pass
                
                if 'route_data' in data:
                    try:
                        data['route_data'] = json.loads(data['route_data'])
                    except (json.JSONDecodeError, TypeError):
                        pass
            
            print(f"\n{'='*80}")
            print(f"🎯 API PUT /routes/api/routes/{pk}/")
            print(f"{'='*80}")
            print(f"Ключи данных: {list(data.keys())}")
            print(f"main_photo_id: {data.get('main_photo_id')}")
            print(f"photos_data: {data.get('photos_data')}")
            print(f"route_photos: {data.get('route_photos')}")

            # Обновляем маршрут
            route.name = data.get("name", route.name)
            route.description = data.get("description", route.description)
            route.short_description = data.get(
                "short_description", route.short_description
            )
            route.privacy = data.get("privacy", route.privacy)
            route.route_type = data.get("route_type", route.route_type)
            route.duration_minutes = data.get(
                "duration_minutes", route.duration_minutes
            )
            route.total_distance = data.get(
                "total_distance", route.total_distance
            )
            route.has_audio_guide = data.get(
                "has_audio_guide", route.has_audio_guide
            )
            route.is_elderly_friendly = data.get(
                "is_elderly_friendly", route.is_elderly_friendly
            )
            route.is_active = data.get("is_active", route.is_active)
            route.duration_display = data.get("duration_display", route.duration_display)
            route.save()

            # Сохраняем фото существующих точек (чтобы восстановить, если фронтенд не прислал фото)
            old_point_photos = {}
            old_points_qs = route.points.all()
            old_points = {p.id: p for p in old_points_qs}
            for old_point in old_points_qs:
                photos_for_point = []
                for photo in old_point.photos.all().order_by("order"):
                    photos_for_point.append({
                        "url": photo.image.url if photo.image else "",
                        "caption": photo.caption or "",
                        "order": photo.order
                    })
                if photos_for_point:
                    old_point_photos[old_point.id] = photos_for_point

            # Если клиент указал явный список удаляемых фото — удаляем только их.
            removed_photo_ids = data.get('removed_photo_ids', [])
            if removed_photo_ids:
                for photo_id in removed_photo_ids:
                    try:
                        photo = RoutePhoto.objects.get(id=photo_id, route=route)
                        photo.delete()
                    except RoutePhoto.DoesNotExist:
                        pass

            # === ОБРАБОТКА ГЛАВНОГО ФОТО ===
            # Проверяем есть ли данные о главном фото
            main_photo_id = data.get("main_photo_id")
            
            # Если main_photo_id в photos_data, используем оттуда
            photos_data = data.get("photos_data")
            if photos_data and isinstance(photos_data, dict):
                main_photo_id = photos_data.get("main_photo_id", main_photo_id)
            
            if main_photo_id:
                print(f"🎯 API PUT: Установка главного фото ID {main_photo_id}")
                try:
                    main_photo_id = int(main_photo_id)
                    main_photo = RoutePhoto.objects.filter(id=main_photo_id, route=route).first()
                    if main_photo:
                        # Сбрасываем is_main для всех
                        RoutePhoto.objects.filter(route=route).update(is_main=False)
                        # Устанавливаем это фото как главное
                        main_photo.is_main = True
                        main_photo.order = 0
                        main_photo.save()
                        print(f"  ✅ Фото {main_photo_id} установлено как главное")
                        
                        # Переиндексируем остальные фото
                        other_photos = RoutePhoto.objects.filter(route=route).exclude(id=main_photo_id).order_by('id')
                        for idx, photo in enumerate(other_photos, start=1):
                            photo.order = idx
                            photo.save()
                    else:
                        print(f"  ❌ Фото {main_photo_id} не найдено")
                except (ValueError, TypeError) as e:
                    print(f"  ❌ Ошибка: {e}")

            # Добавляем фото маршрута
            route_photos = data.get("route_photos", [])
            for i, photo_data in enumerate(route_photos):
                if photo_data:
                    try:
                        if photo_data.startswith("data:"):
                            save_base64_photo(
                                photo_data, route, RoutePhoto, order=i
                            )
                        elif photo_data.startswith(
                            "/uploads/"
                        ) or photo_data.startswith("/media/"):
                            copy_existing_photo(
                                photo_data, route, RoutePhoto, order=i
                            )
                    except Exception as e:
                        print(f"Ошибка сохранения фото маршрута: {e}")
                        continue

            # Обновляем/создаём точки (не удаляем все сразу)
            waypoints_data = data.get("waypoints", [])

            # Нормализуем входящие ID точек
            incoming_ids = []
            for pd in waypoints_data:
                pid = pd.get('id')
                if pid:
                    try:
                        incoming_ids.append(int(pid))
                    except Exception:
                        incoming_ids.append(pid)

            # Удаляем только те точки, которые отсутствуют во входящих данных
            if incoming_ids:
                to_delete_qs = route.points.exclude(id__in=incoming_ids)
                deleted_count = to_delete_qs.count()
                if deleted_count:
                    to_delete_qs.delete()
            else:
                # Если incoming_ids пуст — не трогаем существующие точки
                pass

            for i, point_data in enumerate(waypoints_data):
                point_name = point_data.get("name", f"Точка {i+1}")
                incoming_id = point_data.get('id')
                incoming_id_key = None
                if incoming_id is not None:
                    try:
                        incoming_id_key = int(incoming_id)
                    except Exception:
                        incoming_id_key = incoming_id

                if incoming_id_key and incoming_id_key in old_points:
                    # Обновляем существующую точку
                    point = old_points[incoming_id_key]
                    point.name = point_name
                    point.description = point_data.get('description', '')
                    point.address = point_data.get('address', '')
                    point.latitude = point_data.get('lat', point.latitude)
                    point.longitude = point_data.get('lng', point.longitude)
                    point.category = point_data.get('category', point.category)
                    point.order = i
                    point.save()
                else:
                    # Создаём новую точку
                    point = RoutePoint.objects.create(
                        route=route,
                        name=point_name,
                        description=point_data.get('description', ''),
                        address=point_data.get('address', ''),
                        latitude=point_data.get('lat', point_data.get('latitude', 0)),
                        longitude=point_data.get('lng', point_data.get('longitude', 0)),
                        category=point_data.get('category', ''),
                        order=i,
                    )

                # === ОБРАБОТКА ФОТО ТОЧКИ (БЕЗ АВТОМАТИЧЕСКОГО УДАЛЕНИЯ!) ===
                point_photos = point_data.get('photos', None)

                # 1. Удаляем только явно указанные фото (из removed_point_photo_ids)
                removed_point_photo_ids = data.get('removed_point_photo_ids', [])
                if isinstance(removed_point_photo_ids, list):
                    for photo_id in removed_point_photo_ids:
                        try:
                            photo = PointPhoto.objects.get(id=photo_id, point=point)
                            photo.delete()
                            print(f"🗑️ Удалено фото точки ID: {photo_id}")
                        except PointPhoto.DoesNotExist:
                            pass

                # 2. Добавляем/сохраняем фото ТОЛЬКО если они присланы
                if isinstance(point_photos, list):
                    # НЕ удаляем старые фото! Только добавляем/сохраняем новые
                    for j, photo_data in enumerate(point_photos):
                        if not photo_data:
                            continue
                        try:
                            if isinstance(photo_data, str) and photo_data.startswith('data:'):
                                save_base64_photo(photo_data, point, PointPhoto, order=j)
                            elif isinstance(photo_data, str) and (photo_data.startswith('/uploads/') or photo_data.startswith('/media/')):
                                copy_existing_photo(photo_data, point, PointPhoto, order=j)
                            elif isinstance(photo_data, dict):
                                photo_url = photo_data.get('url', '')
                                caption = photo_data.get('caption', '')
                                if photo_url.startswith('data:'):
                                    save_base64_photo(photo_url, point, PointPhoto, order=j, caption=caption)
                                elif photo_url.startswith('/uploads/') or photo_url.startswith('/media/'):
                                    copy_existing_photo(photo_url, point, PointPhoto, order=j, caption=caption)
                        except Exception as e:
                            print(f"Ошибка сохранения фото точки {point.id}: {e}")
                            continue
                else:
                    # Если 'photos' вообще не передано — оставляем как есть (не трогаем)
                    print(f"ℹ️ Фото для точки {point.id} не переданы → оставляем текущие")

            return JsonResponse(
                {"success": True, "route_id": route.id, "id": route.id}
            )

        except json.JSONDecodeError:
            return JsonResponse(
                {"success": False, "error": "Неверный формат JSON"}
            )
        except Exception as e:
            return JsonResponse(
                {"success": False, "error": f"Ошибка сервера: {str(e)}"}
            )

    def post(self, request, pk):
        return self.put(request, pk)


@login_required
@csrf_exempt
def generate_qr_code(request, route_id):
    """Генерация QR кода для маршрута"""
    route = get_object_or_404(Route, id=route_id)

    # Проверяем права доступа
    if route.author != request.user and not request.user.is_staff:
        return JsonResponse(
            {
                "success": False,
                "error": "У вас нет прав для генерации QR кода этого маршрута",
            }
        )

    try:
        qr_url = route.generate_qr_code(request)
        return JsonResponse(
            {
                "success": True,
                "qr_url": qr_url,
                "route_url": request.build_absolute_uri(
                    route.get_absolute_url()
                ),
            }
        )
    except Exception as e:
        return JsonResponse(
            {"success": False, "error": f"Ошибка генерации QR кода: {str(e)}"}
        )


def route_qr_code(request, route_id):
    """Страница с QR кодом маршрута"""
    route = get_object_or_404(Route, id=route_id)

    # Проверка доступа к маршруту
    if not can_view_route(request.user, route):
        messages.error(request, "У вас нет доступа к этому маршруту")
        return redirect("home")

    # Генерируем QR код если его нет
    qr_url = route.qr_code.url if route.qr_code else None
    if not qr_url:
        qr_url = route.generate_qr_code(request)

    route_url = request.build_absolute_uri(route.get_absolute_url())

    context = {
        "route": route,
        "qr_url": qr_url,
        "route_url": route_url,
    }

    if request.user.is_authenticated:
        context["pending_friend_requests"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5]
        context["pending_requests_count"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count()

    return render(request, "routes/route_qr_code.html", context)


@login_required
@csrf_exempt
def share_route_access(request, route_id):
    """Предоставление доступа к маршруту по email"""
    route = get_object_or_404(Route, id=route_id)

    # Проверяем права доступа
    if route.author != request.user and not request.user.is_staff:
        return JsonResponse(
            {
                "success": False,
                "error": "У вас нет прав для предоставления доступа к этому маршруту",
            }
        )

    try:
        data = json.loads(request.body)
        email = data.get("email", "").strip()
        access_level = data.get("access_level", "view")

        if not email:
            return JsonResponse({"success": False, "error": "Email не указан"})

        try:
            target_user = User.objects.get(email=email)
        except User.DoesNotExist:
            return JsonResponse(
                {
                    "success": False,
                    "error": "Пользователь с таким email не зарегистрирован",
                }
            )

        if target_user == request.user:
            return JsonResponse(
                {
                    "success": False,
                    "error": "Нельзя предоставить доступ самому себе",
                }
            )

        # Предоставляем доступ
        route.privacy = "personal"
        route.shared_with.add(target_user)
        route.save()

        return JsonResponse(
            {
                "success": True,
                "message": f"Доступ к маршруту «{route.name}» предоставлен пользователю {email}",
            }
        )

    except json.JSONDecodeError:
        return JsonResponse(
            {"success": False, "error": "Неверный формат данных"}
        )
    except Exception as e:
        return JsonResponse({"success": False, "error": f"Ошибка: {str(e)}"})


@login_required
@csrf_exempt
def get_friends_list(request):
    """Получение списка друзей пользователя"""
    try:
        friends = Friendship.objects.filter(
            Q(from_user=request.user, status="accepted")
            | Q(to_user=request.user, status="accepted")
        ).select_related("from_user", "to_user")

        friends_list = []
        for friendship in friends:
            if friendship.from_user == request.user:
                friend = friendship.to_user
            else:
                friend = friendship.from_user

            friends_list.append(
                {
                    "id": friend.id,
                    "username": friend.username,
                    "first_name": friend.first_name,
                    "last_name": friend.last_name,
                    "email": friend.email,
                }
            )

        return JsonResponse({"success": True, "friends": friends_list})

    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)})