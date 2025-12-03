# routes/views.py
__all__ = ()

import json
import math
from io import BytesIO
from django.core.files.base import ContentFile
import base64

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.paginator import Paginator
from django.db.models import Q, Count, Avg
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.shortcuts import render, get_object_or_404, redirect
from django.utils import timezone
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.core.files import File
from django.http import HttpResponse

from routes.models import (
    Route,
    RoutePoint,
    RouteFavorite,
    RouteRating,
    SavedPlace,
    RouteComment,
    PointComment,
    User,
)
from routes.models import RoutePhoto, PointPhoto  # ДОБАВЬТЕ ЭТОТ ИМПОРТ
from users.models import Friendship


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
    adventure_count = Route.objects.filter(
        mood="adventure", is_active=True
    ).count()

    # Популярные маршруты
    popular_routes = Route.objects.filter(is_active=True).order_by(
        "-created_at"
    )[:6]

    context = {
        "popular_routes": popular_routes,
        "walking_count": walking_count,
        "driving_count": driving_count,
        "cycling_count": cycling_count,
        "adventure_count": adventure_count,
        "total_routes": total_routes,
        "total_users": total_users,
        "total_countries": total_countries,
    }

    return render(request, "home.html", context)


def all_routes(request):
    """Все публичные маршруты"""
    routes = Route.objects.filter(privacy="public", is_active=True).prefetch_related('photos')

    # Фильтрация
    route_type = request.GET.get("type")
    mood = request.GET.get("mood")
    theme = request.GET.get("theme")
    search_query = request.GET.get("q")

    if route_type:
        routes = routes.filter(route_type=route_type)
    if mood:
        routes = routes.filter(mood=mood)
    if theme:
        routes = routes.filter(theme=theme)
    if search_query:
        routes = routes.filter(
            Q(name__icontains=search_query)
            | Q(description__icontains=search_query)
            | Q(short_description__icontains=search_query)
            | Q(points__name__icontains=search_query)
            | Q(points__description__icontains=search_query)
        ).distinct()

    # Аннотируем средний рейтинг
    routes = routes.annotate(
        rating=Avg("ratings__rating"),
        rating_count=Count("ratings")
    ).order_by("-created_at")

    # Пагинация
    paginator = Paginator(routes, 12)
    page_number = request.GET.get("page")
    page_obj = paginator.get_page(page_number)

    context = {
        "page_obj": page_obj,
        "route_types": Route.ROUTE_TYPE_CHOICES,
        "moods": Route.MOOD_CHOICES,
        "themes": Route.THEME_CHOICES,
    }

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
    """Маршруты пользователя с разделением на активные/неактивные"""
    routes = Route.objects.filter(author=request.user).prefetch_related('photos')
    
    # Аннотируем средний рейтинг
    routes = routes.annotate(
        rating=Avg("ratings__rating"),
        rating_count=Count("ratings")
    ).order_by("-created_at")
    
    # Разделяем маршруты на активные и неактивные
    active_routes = routes.filter(is_active=True)
    inactive_routes = routes.filter(is_active=False)
    
    context = {
        "routes": routes,
        "active_routes": active_routes,
        "inactive_routes": inactive_routes,
        "pending_friend_requests": Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5],
        "pending_requests_count": Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count(),
    }
    return render(request, "routes/my_routes.html", context)


@login_required
def shared_routes(request):
    # Все в одном запросе с Q объектами
    routes = Route.objects.filter(
        Q(shared_with=request.user) | Q(privacy="link"),
        is_active=True
    ).exclude(author=request.user).prefetch_related('photos').distinct()
    
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
    route = get_object_or_404(Route, id=route_id)

    # Проверка доступа
    if not can_view_route(request.user, route):
        messages.error(request, "У вас нет доступа к этому маршруту")
        return redirect("home")

    points = route.points.all().order_by("order").prefetch_related("photos")
    comments = route.comments.all().order_by("-created_at")[:10]
    route_photos = route.photos.all().order_by("order")

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

    user_favorites_ids = []
    if request.user.is_authenticated:
        user_favorites_ids = RouteFavorite.objects.filter(
            user=request.user
        ).values_list("route_id", flat=True)

    user_rating = None
    if request.user.is_authenticated:
        try:
            user_rating = RouteRating.objects.get(
                user=request.user, route=route
            ).rating
        except RouteRating.DoesNotExist:
            pass

    similar_routes = Route.objects.filter(
        route_type=route.route_type, privacy="public", is_active=True
    ).exclude(id=route.id)[:5]

    context = {
        "route": route,
        "points": points,
        "route_photos": route_photos,
        "comments": comments,
        "route_chat_messages": route_chat_messages,
        "user_favorites_ids": list(user_favorites_ids),
        "user_rating": user_rating,
        "similar_routes": similar_routes,
        # ДОБАВЛЯЕМ AI аудио данные
        "full_audio_guide": full_audio_guide,
        "points_with_audio": points_with_audio,
    }

    if request.user.is_authenticated:
        context["pending_friend_requests"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5]
        context["pending_requests_count"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count()

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
                mood=data.get("mood", ""),
                theme=data.get("theme", ""),
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
                        # Проверяем формат фото
                        if photo_data.startswith("data:"):
                            # Это DataURL - новое фото
                            photo = save_base64_photo(
                                photo_data, route, RoutePhoto, order=i
                            )
                        elif photo_data.startswith(
                            "/uploads/"
                        ) or photo_data.startswith("/media/"):
                            # Это уже сохраненное фото - копируем из существующего
                            photo = copy_existing_photo(
                                photo_data, route, RoutePhoto, order=i
                            )
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
                    hint_author=point_data.get("hint_author", ""),
                    tags=point_data.get("tags", []),
                    order=i,
                )

                # Добавляем фото точки если есть
                point_photos = point_data.get("photos", [])
                for j, photo_data in enumerate(point_photos):
                    if photo_data:
                        try:
                            if photo_data.startswith("data:"):
                                save_base64_photo(
                                    photo_data, point, PointPhoto, order=j
                                )
                            elif photo_data.startswith(
                                "/uploads/"
                            ) or photo_data.startswith("/media/"):
                                copy_existing_photo(
                                    photo_data, point, PointPhoto, order=j
                                )
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


@login_required
def edit_route(request, route_id):
    """Редактирование маршрута"""
    route = get_object_or_404(Route, id=route_id, author=request.user)

    if request.method == "POST":
        try:
            data = json.loads(request.body)
            print("=== РЕДАКТИРОВАНИЕ МАРШРУТА ===")
            print("Полученные данные:", data.get("name"), "точек:", len(data.get("points", [])))
            
            # Обновляем основные поля маршрута
            route.name = data.get("name", route.name)
            route.description = data.get("description", route.description)
            route.short_description = data.get("short_description", route.short_description)
            route.privacy = data.get("privacy", route.privacy)
            route.route_type = data.get("route_type", route.route_type)
            route.mood = data.get("mood", route.mood)
            route.theme = data.get("theme", route.theme)
            route.duration_minutes = data.get("duration_minutes", route.duration_minutes)
            route.total_distance = data.get("total_distance", route.total_distance)
            route.has_audio_guide = data.get("has_audio_guide", route.has_audio_guide)
            route.is_elderly_friendly = data.get("is_elderly_friendly", route.is_elderly_friendly)
            route.is_active = data.get("is_active", route.is_active)
            route.save()
            
            # === ОБРАБОТКА ФОТО МАРШРУТА ===
            photos_data = data.get("photos_data", {})
            
            # Обрабатываем существующие фото
            existing_main_photo_id = photos_data.get("existing_main_photo_id")
            existing_additional_ids = photos_data.get("existing_additional_photo_ids", [])
            removed_photo_ids = data.get("removed_photo_ids", [])
            
            # Обновляем существующие фото (подписи и порядок)
            captions = photos_data.get("captions", {})
            
            # Помечаем фото как удаленные
            for photo_id in removed_photo_ids:
                try:
                    photo = RoutePhoto.objects.get(id=photo_id, route=route)
                    photo.delete()
                    print(f"🗑️ Удалено фото ID: {photo_id}")
                except RoutePhoto.DoesNotExist:
                    pass
            
            # Удаляем все существующие точки (для простоты)
            route.points.all().delete()
            
            # === ОБРАБОТКА ТОЧЕК ===
            points_data = data.get("points", [])
            print(f"Точек получено: {len(points_data)}")
            
            # Создаем новые точки
            for i, point_data in enumerate(points_data):
                point_name = point_data.get("name", f"Точка {i+1}")
                print(f"Создание точки {i}: {point_name}")
                
                point = RoutePoint.objects.create(
                    route=route,
                    name=point_name,
                    description=point_data.get("description", ""),
                    address=point_data.get("address", ""),
                    latitude=point_data.get("lat", point_data.get("latitude", 0)),
                    longitude=point_data.get("lng", point_data.get("longitude", 0)),
                    category=point_data.get("category", ""),
                    hint_author=point_data.get("hint_author", ""),
                    tags=point_data.get("tags", []),
                    order=i,
                )
                
                # Обрабатываем фото точки
                point_photos_data = point_data.get("photos", [])
                print(f"  Фото точки: {len(point_photos_data)} шт.")
                
                for j, photo_data in enumerate(point_photos_data):
                    if isinstance(photo_data, dict):
                        photo_url = photo_data.get("url", "")
                        photo_caption = photo_data.get("caption", "")
                        
                        if photo_url and photo_url.startswith("data:"):
                            # Новое фото в base64
                            save_base64_photo(photo_url, point, PointPhoto, order=j, caption=photo_caption)
                            print(f"  ✅ Добавлено новое фото из base64")
                        elif photo_url and (photo_url.startswith("/media/") or photo_url.startswith("/uploads/")):
                            # Копируем существующее фото
                            copy_existing_photo(photo_url, point, PointPhoto, order=j, caption=photo_caption)
                            print(f"  ✅ Скопировано существующее фото")
                    elif isinstance(photo_data, str) and photo_data:
                        # Старый формат - строка URL
                        if photo_data.startswith("data:"):
                            save_base64_photo(photo_data, point, PointPhoto, order=j)
                        elif photo_data.startswith("/media/") or photo_data.startswith("/uploads/"):
                            copy_existing_photo(photo_data, point, PointPhoto, order=j)
            
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
        "mood": route.mood,
        "theme": route.theme,
        "duration_minutes": route.duration_minutes,
        "total_distance": route.total_distance,
        "has_audio_guide": route.has_audio_guide,
        "is_elderly_friendly": route.is_elderly_friendly,
        "is_active": route.is_active,
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
            "hint_author": point.hint_author or "",
            "tags": point.tags if point.tags else [],
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
    """Сохранение фото из base64 DataURL"""
    try:
        print(f"=== DEBUG SAVE BASE64 PHOTO ===")
        print(f"🔧 Сохранение фото для {parent_obj.__class__.__name__} {parent_obj.id if hasattr(parent_obj, 'id') else 'new'}")
        print(f"📷 Photo model: {photo_model.__name__}")
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

        # Создаем имя файла
        timestamp = int(timezone.now().timestamp())
        filename = f"{parent_obj.__class__.__name__.lower()}_{photo_model.__name__.lower()}_{timestamp}_{order}{ext}"

        print(f"📁 Имя файла: {filename}")
        print(f"📁 MIME type: {mime_type}")

        # Создаем объект фото
        kwargs = {}
        if parent_obj.__class__.__name__ == "Route":
            kwargs["route"] = parent_obj
        elif parent_obj.__class__.__name__ == "RoutePoint":
            kwargs["point"] = parent_obj

        # Добавляем caption и order
        photo = photo_model.objects.create(
            **kwargs, 
            order=order, 
            caption=caption
        )

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
    """Копирование существующего фото"""
    try:
        print(f"=== DEBUG COPY EXISTING PHOTO ===")
        print(f"🔧 Копирование фото: {photo_url}")
        print(f"📷 Для: {parent_obj.__class__.__name__} {parent_obj.id}")
        print(f"📝 Caption: {caption}")

        # Ищем существующее фото
        from django.conf import settings
        import os

        # Определяем путь к файлу из URL
        if photo_url.startswith("/media/"):
            media_path = photo_url.replace("/media/", "")
        elif photo_url.startswith("/uploads/"):
            media_path = photo_url.replace("/uploads/", "")
        else:
            print(f"❌ Неверный URL фото: {photo_url}")
            return None
            
        full_path = os.path.join(settings.MEDIA_ROOT, media_path)

        if not os.path.exists(full_path):
            print(f"❌ Файл не найден: {full_path}")
            return None

        # Создаем новое имя файла
        timestamp = int(timezone.now().timestamp())
        ext = os.path.splitext(full_path)[1]
        filename = f"{parent_obj.__class__.__name__.lower()}_{parent_obj.id}_{photo_model.__name__.lower()}_{timestamp}_{order}{ext}"

        # Читаем существующий файл
        with open(full_path, "rb") as f:
            file_data = f.read()

        # Создаем объект фото
        kwargs = {}
        if parent_obj.__class__.__name__ == "Route":
            kwargs["route"] = parent_obj
        elif parent_obj.__class__.__name__ == "RoutePoint":
            kwargs["point"] = parent_obj

        photo = photo_model.objects.create(
            **kwargs, 
            order=order, 
            caption=caption
        )

        # Сохраняем копию файла
        photo.image.save(filename, ContentFile(file_data), save=True)

        print(f"✅ Фото скопировано успешно!")
        print(f"📁 Новый URL: {photo.image.url}")
        print(f"=== END DEBUG COPY PHOTO ===")

        return photo

    except Exception as e:
        print(f"❌ Ошибка копирования фото: {e}")
        import traceback
        print(f"🔍 Traceback: {traceback.format_exc()}")
        return None


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


# Сохраненные места
@login_required
def saved_places(request):
    """Управление сохраненными местами"""
    places = SavedPlace.objects.filter(user=request.user).order_by(
        "-created_at"
    )

    context = {
        "places": places,
        "pending_friend_requests": Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5],
        "pending_requests_count": Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count(),
    }
    return render(request, "places/saved_places.html", context)


@login_required
@csrf_exempt
def add_saved_place(request):
    """Добавление сохраненного места"""
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            place = SavedPlace.objects.create(
                user=request.user,
                name=data["name"],
                category=data.get("category", "other"),
                address=data["address"],
                latitude=data["lat"],
                longitude=data["lng"],
                notes=data.get("notes", ""),
            )
            return JsonResponse({"success": True, "place_id": place.id})
        except Exception as e:
            return JsonResponse({"success": False, "error": str(e)})

    return JsonResponse({"success": False, "error": "Only POST allowed"})


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
            "category": {"name": route.theme} if route.theme else None,
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

    context = {
        "routes": routes,
        "page_title": "Автомобильные маршруты",
        "route_type": "driving",
        "total_count": routes.count(),
    }
    return render(request, "routes/filtered_routes.html", context)

def cycling_routes(request):
    """Страница с велосипедными маршрутами"""
    routes = Route.objects.filter(route_type="cycling", is_active=True).prefetch_related('photos')

    context = {
        "routes": routes,
        "page_title": "Велосипедные маршруты",
        "route_type": "cycling",
        "total_count": routes.count(),
    }
    return render(request, "routes/filtered_routes.html", context)

def adventure_routes(request):
    """Страница с приключенческими маршрутами"""
    routes = Route.objects.filter(mood="adventure", is_active=True).prefetch_related('photos')

    context = {
        "routes": routes,
        "page_title": "Приключенческие маршруты",
        "mood_type": "adventure",
        "total_count": routes.count(),
    }
    return render(request, "routes/filtered_routes.html", context)


def search_routes(request):
    """Отдельная view для поиска"""
    query = request.GET.get("q", "")
    route_type = request.GET.get("type", "")
    mood = request.GET.get("mood", "")

    routes = Route.objects.filter(is_active=True)

    if query:
        routes = routes.filter(
            Q(name__icontains=query)
            | Q(description__icontains=query)
            | Q(country__icontains=query)
        )

    if route_type:
        routes = routes.filter(route_type=route_type)

    if mood:
        routes = routes.filter(mood=mood)

    context = {
        "routes": routes,
        "query": query,
        "route_type": route_type,
        "mood": mood,
        "total_count": routes.count(),
    }
    return render(request, "routes/search_results.html", context)


class RouteCreateView(LoginRequiredMixin, View):
    def post(self, request):
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
                mood=data.get("mood", ""),
                theme=data.get("theme", ""),
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
                    hint_author=point_data.get("hint_author", ""),
                    tags=point_data.get("tags", []),
                    order=i,
                )

                # Добавляем фото точки
                point_photos = point_data.get("photos", [])
                for j, photo_data in enumerate(point_photos):
                    if photo_data:
                        try:
                            if photo_data.startswith("data:"):
                                save_base64_photo(
                                    photo_data, point, PointPhoto, order=j
                                )
                            elif photo_data.startswith(
                                "/uploads/"
                            ) or photo_data.startswith("/media/"):
                                copy_existing_photo(
                                    photo_data, point, PointPhoto, order=j
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
            data = json.loads(request.body)

            # Обновляем маршрут
            route.name = data.get("name", route.name)
            route.description = data.get("description", route.description)
            route.short_description = data.get(
                "short_description", route.short_description
            )
            route.privacy = data.get("privacy", route.privacy)
            route.route_type = data.get("route_type", route.route_type)
            route.mood = data.get("mood", route.mood)
            route.theme = data.get("theme", route.theme)
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
            route.save()

            # Удаляем старые точки и фото
            route.points.all().delete()
            route.photos.all().delete()

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
                    hint_author=point_data.get("hint_author", ""),
                    tags=point_data.get("tags", []),
                    order=i,
                )

                # Добавляем фото точки
                point_photos = point_data.get("photos", [])
                for j, photo_data in enumerate(point_photos):
                    if photo_data:
                        try:
                            if photo_data.startswith("data:"):
                                save_base64_photo(
                                    photo_data, point, PointPhoto, order=j
                                )
                            elif photo_data.startswith(
                                "/uploads/"
                            ) or photo_data.startswith("/media/"):
                                copy_existing_photo(
                                    photo_data, point, PointPhoto, order=j
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
