__all__ = ()

import json
import math

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

from routes.models import Route, RoutePoint, RouteFavorite, RouteRating, SavedPlace, RouteComment, PointComment, User
from users.models import Friendship


def home(request):
    # Получаем реальную статистику
    total_routes = Route.objects.filter(is_active=True).count()
    total_users = User.objects.count()
    
    # Считаем уникальные страны
    total_countries = Route.objects.filter(is_active=True).values('country').distinct().count()
    
    # Считаем маршруты по типам (только активные)
    walking_count = Route.objects.filter(route_type='walking', is_active=True).count()
    driving_count = Route.objects.filter(route_type='driving', is_active=True).count()
    cycling_count = Route.objects.filter(route_type='cycling', is_active=True).count()
    adventure_count = Route.objects.filter(mood='adventure', is_active=True).count()
    
    # Популярные маршруты
    popular_routes = Route.objects.filter(is_active=True).order_by('-created_at')[:6]
    
    context = {
        'popular_routes': popular_routes,
        'walking_count': walking_count,
        'driving_count': driving_count,
        'cycling_count': cycling_count,
        'adventure_count': adventure_count,
        'total_routes': total_routes,
        'total_users': total_users,
        'total_countries': total_countries,
    }
    
    return render(request, 'home.html', context)


def all_routes(request):
    """Все публичные маршруты"""
    routes = Route.objects.filter(privacy="public", is_active=True)

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
        avg_rating=Avg("ratings__rating"), rating_count=Count("ratings")
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
    routes = Route.objects.filter(author=request.user).order_by("-created_at")
    
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
    """Маршруты, доступные пользователю"""
    routes = (
        Route.objects.filter(Q(shared_with=request.user) | Q(privacy="link"))
        .exclude(author=request.user)
        .distinct()
        .order_by("-created_at")
    )

    context = {
        "routes": routes,
        "pending_friend_requests": Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5],
        "pending_requests_count": Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count(),
    }
    return render(request, "routes/shared_routes.html", context)


def route_detail(request, route_id):
    """Детальная страница маршрута"""
    route = get_object_or_404(Route, id=route_id)

    # Проверка доступа
    if not can_view_route(request.user, route):
        messages.error(request, "У вас нет доступа к этому маршруту")
        return redirect("home")

    points = route.points.all().order_by("order")
    comments = route.comments.all().order_by("-created_at")[:10]

    # Сообщения чата маршрута
    route_chat_messages = []
    if hasattr(route, 'chat'):
        route_chat_messages = route.chat.messages.all().select_related('user').order_by('-timestamp')[:20]
 
    user_favorites_ids = []
    if request.user.is_authenticated:
        user_favorites_ids = RouteFavorite.objects.filter(
            user=request.user
        ).values_list('route_id', flat=True)

    user_rating = None
    if request.user.is_authenticated:
        try:
            user_rating = RouteRating.objects.get(user=request.user, route=route).rating
        except RouteRating.DoesNotExist:
            pass

    similar_routes = Route.objects.filter(
        route_type=route.route_type,
        privacy="public",
        is_active=True
    ).exclude(id=route.id)[:5]

    context = {
        "route": route,
        "points": points,
        "comments": comments,
        "route_chat_messages": route_chat_messages,
        "user_favorites_ids": list(user_favorites_ids),
        "user_rating": user_rating,
        "similar_routes": similar_routes,
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

            if not data.get("points"):
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Добавьте хотя бы одну точку маршрута",
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

            # Добавляем точки
            points_data = data.get("points", [])
            for i, point_data in enumerate(points_data):
                RoutePoint.objects.create(
                    route=route,
                    name=point_data.get("name", f"Точка {i+1}"),
                    description=point_data.get("description", ""),
                    address=point_data.get("address", ""),
                    latitude=point_data["lat"],
                    longitude=point_data["lng"],
                    category=point_data.get("category", ""),
                    hint_author=point_data.get("hint_author", ""),
                    tags=point_data.get("tags", []),
                    order=i,
                )

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

            # Обновляем точки
            route.points.all().delete()
            points_data = data.get("points", [])
            for i, point_data in enumerate(points_data):
                RoutePoint.objects.create(
                    route=route,
                    name=point_data.get("name", f"Точка {i+1}"),
                    description=point_data.get("description", ""),
                    address=point_data.get("address", ""),
                    latitude=point_data["lat"],
                    longitude=point_data["lng"],
                    category=point_data.get("category", ""),
                    hint_author=point_data.get("hint_author", ""),
                    tags=point_data.get("tags", []),
                    order=i,
                )

            return JsonResponse({"success": True, "route_id": route.id})
        except Exception as e:
            return JsonResponse({"success": False, "error": str(e)})

    # Подготавливаем данные для редактора
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
        "points": [
            {
                "name": point.name,
                "description": point.description,
                "address": point.address,
                "lat": point.latitude,
                "lng": point.longitude,
                "category": point.category,
                "hint_author": point.hint_author,
                "tags": point.tags,
            }
            for point in route.points.all().order_by("order")
        ],
    }

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


# Карта всех точек
def map_view(request):
    routes = Route.objects.filter(
        privacy="public", is_active=True
    ).prefetch_related("points")
    routes_json = json.dumps(
        [
            {
                "id": r.id,
                "title": r.name,
                "short_description": r.short_description,
                "description": r.description,
                "distance": r.total_distance,
                "rating": r.get_average_rating() or 0,
                "has_audio": r.has_audio_guide,
                "difficulty": r.route_type,  # или отдельное поле
                "category": {"name": r.theme} if r.theme else None,
                "points": [
                    {
                        "lat": p.latitude,
                        "lng": p.longitude,
                        "name": p.name,
                        "address": p.address,
                        "description": p.description,
                        "order": p.order,
                    }
                    for p in r.points.all()
                ],
            }
            for r in routes
        ]
    )
    return render(
        request,
        "map/map_view.html",
        {"routes_json": routes_json, "routes": routes},
    )


# Вспомогательные функции
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
        return True  # Доступ по ссылке - всегда доступно
    return False


@login_required
@require_http_methods(["POST"])
def share_route(request, route_id):
    from django.contrib.auth import get_user_model
    User = get_user_model()

    try:
        route = Route.objects.get(id=route_id, author=request.user)
    except Route.DoesNotExist:
        return JsonResponse({
            'success': False,
            'error': 'Маршрут не найден или вы не автор'
        }, status=403)

    try:
        data = json.loads(request.body)
        email = data.get('email', '').strip()
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({
            'success': False,
            'error': 'Некорректный формат данных'
        }, status=400)

    if not email:
        return JsonResponse({
            'success': False,
            'error': 'Email не указан'
        }, status=400)

    try:
        target_user = User.objects.get(email=email)
    except User.DoesNotExist:
        return JsonResponse({
            'success': False,
            'error': 'Пользователь с таким email не зарегистрирован'
        }, status=404)

    if target_user == request.user:
        return JsonResponse({
            'success': False,
            'error': 'Нельзя предоставить доступ самому себе'
        }, status=400)

    route.privacy = "personal"
    route.shared_with.add(target_user)
    route.save()

    return JsonResponse({
        'success': True,
        'message': f'Доступ к маршруту «{route.name}» предоставлен пользователю {email}'
    })


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
    routes = Route.objects.filter(route_type='walking', is_active=True)
    
    context = {
        'routes': routes,
        'page_title': 'Пешие маршруты',
        'route_type': 'walking',
        'total_count': routes.count()
    }
    return render(request, 'routes/filtered_routes.html', context)

def driving_routes(request):
    """Страница с автомобильными маршрутами"""
    routes = Route.objects.filter(route_type='driving', is_active=True)
    
    context = {
        'routes': routes,
        'page_title': 'Автомобильные маршруты',
        'route_type': 'driving',
        'total_count': routes.count()
    }
    return render(request, 'routes/filtered_routes.html', context)

def cycling_routes(request):
    """Страница с велосипедными маршрутами"""
    routes = Route.objects.filter(route_type='cycling', is_active=True)
    
    context = {
        'routes': routes,
        'page_title': 'Велосипедные маршруты',
        'route_type': 'cycling',
        'total_count': routes.count()
    }
    return render(request, 'routes/filtered_routes.html', context)

def adventure_routes(request):
    """Страница с приключенческими маршрутами"""
    routes = Route.objects.filter(mood='adventure', is_active=True)
    
    context = {
        'routes': routes,
        'page_title': 'Приключенческие маршруты',
        'mood_type': 'adventure',
        'total_count': routes.count()
    }
    return render(request, 'routes/filtered_routes.html', context)

def search_routes(request):
    """Отдельная view для поиска"""
    query = request.GET.get('q', '')
    route_type = request.GET.get('type', '')
    mood = request.GET.get('mood', '')
    
    routes = Route.objects.filter(is_active=True)
    
    if query:
        routes = routes.filter(
            Q(name__icontains=query) | 
            Q(description__icontains=query) |
            Q(country__icontains=query)
        )
    
    if route_type:
        routes = routes.filter(route_type=route_type)
    
    if mood:
        routes = routes.filter(mood=mood)
    
    context = {
        'routes': routes,
        'query': query,
        'route_type': route_type,
        'mood': mood,
        'total_count': routes.count()
    }
    return render(request, 'routes/search_results.html', context)


class RouteCreateView(LoginRequiredMixin, View):
    def post(self, request):
        try:
            data = json.loads(request.body)
            
            # Валидация обязательных полей
            if not data.get('name'):
                return JsonResponse({"success": False, "error": "Название маршрута обязательно"})
            
            if not data.get('waypoints') or len(data.get('waypoints', [])) < 2:
                return JsonResponse({"success": False, "error": "Добавьте хотя бы две точки маршрута"})

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

            # Добавляем точки
            waypoints_data = data.get("waypoints", [])
            for i, point_data in enumerate(waypoints_data):
                RoutePoint.objects.create(
                    route=route,
                    name=point_data.get("name", f"Точка {i+1}"),
                    description=point_data.get("description", ""),
                    address=point_data.get("address", ""),
                    latitude=point_data["lat"],
                    longitude=point_data["lng"],
                    category=point_data.get("category", ""),
                    hint_author=point_data.get("hint_author", ""),
                    tags=point_data.get("tags", []),
                    order=i,
                )

            return JsonResponse({"success": True, "route_id": route.id, "id": route.id})
            
        except json.JSONDecodeError:
            return JsonResponse({"success": False, "error": "Неверный формат JSON"})
        except KeyError as e:
            return JsonResponse({"success": False, "error": f"Отсутствует обязательное поле: {str(e)}"})
        except Exception as e:
            return JsonResponse({"success": False, "error": f"Ошибка сервера: {str(e)}"})


class RouteUpdateView(LoginRequiredMixin, View):
    def put(self, request, pk):
        try:
            route = get_object_or_404(Route, id=pk, author=request.user)
            data = json.loads(request.body)

            # Обновляем маршрут
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

            # Обновляем точки
            route.points.all().delete()
            waypoints_data = data.get("waypoints", [])
            for i, point_data in enumerate(waypoints_data):
                RoutePoint.objects.create(
                    route=route,
                    name=point_data.get("name", f"Точка {i+1}"),
                    description=point_data.get("description", ""),
                    address=point_data.get("address", ""),
                    latitude=point_data["lat"],
                    longitude=point_data["lng"],
                    category=point_data.get("category", ""),
                    hint_author=point_data.get("hint_author", ""),
                    tags=point_data.get("tags", []),
                    order=i,
                )

            return JsonResponse({"success": True, "route_id": route.id, "id": route.id})
            
        except json.JSONDecodeError:
            return JsonResponse({"success": False, "error": "Неверный формат JSON"})
        except Exception as e:
            return JsonResponse({"success": False, "error": f"Ошибка сервера: {str(e)}"})


    def post(self, request, pk):
        return self.put(request, pk)

