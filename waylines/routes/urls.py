from django.urls import path
from django.contrib.auth import views as auth_views
from . import views

urlpatterns = [
    # Главная страница
    path("", views.home, name="home"),
    path('api/routes/', views.RouteCreateView.as_view(), name='route_create'),
    path('api/routes/<int:pk>/', views.RouteUpdateView.as_view(), name='route_update'),
    # Маршруты
    path("", views.all_routes, name="all_routes"),
    path("my/", views.my_routes, name="my_routes"),
    path("shared/", views.shared_routes, name="shared_routes"),
    path("create/", views.create_route, name="create_route"),
    path("<int:route_id>/", views.route_detail, name="route_detail"),
    path("<int:route_id>/edit/", views.edit_route, name="edit_route"),
    path(
        "routes/<int:route_id>/toggle-active/",
        views.toggle_route_active,
        name="toggle_route_active",
    ),
    path("r<int:route_id>/rate/", views.rate_route, name="rate_route"),
    path(
        "<int:route_id>/favorite/",
        views.toggle_favorite,
        name="toggle_favorite",
    ),
    path(
        "<int:route_id>/comment/",
        views.add_route_comment,
        name="add_route_comment",
    ),
    # Точки
    path(
        "points/<int:point_id>/comment/",
        views.add_point_comment,
        name="add_point_comment",
    ),

    # Сохраненные места
    path("places/", views.saved_places, name="saved_places"),
    path("places/add/", views.add_saved_place, name="add_saved_place"),
    # Карта
    path("map/", views.map_view, name="map_view"),

    # Поиск
    path(
        "search/", views.all_routes, name="search"
    ),  # Используем тот же view что и all_routes
]

# Добавляем обработку статических файлов для разработки
from django.conf import settings
from django.conf.urls.static import static

if settings.DEBUG:
    urlpatterns += static(
        settings.MEDIA_URL, document_root=settings.MEDIA_ROOT
    )
