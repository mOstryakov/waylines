from django.urls import path

from . import views

urlpatterns = [
    # Главная страница
    path("", views.home, name="home"),
    
    # API endpoints
    path('api/routes/', views.RouteCreateView.as_view(), name='route_create'),
    path('api/routes/<int:pk>/', views.RouteUpdateView.as_view(), name='route_update'),
    
    # Маршруты - основные страницы
    path("routes/", views.all_routes, name="all_routes"),
    path("routes/my/", views.my_routes, name="my_routes"),
    path("routes/shared/", views.shared_routes, name="shared_routes"),
    path("routes/create/", views.create_route, name="create_route"),
    
    # Фильтры по типам маршрутов (новые страницы)
    path("routes/walking/", views.walking_routes, name="walking_routes"),
    path("routes/driving/", views.driving_routes, name="driving_routes"),
    path("routes/cycling/", views.cycling_routes, name="cycling_routes"),
    path("routes/adventure/", views.adventure_routes, name="adventure_routes"),
    
    # Детали маршрута и действия
    path("routes/<int:route_id>/", views.route_detail, name="route_detail"),
    path("routes/<int:route_id>/edit/", views.edit_route, name="edit_route"),
    path("routes/<int:route_id>/toggle-active/", views.toggle_route_active, name="toggle_route_active"),
    path("routes/<int:route_id>/rate/", views.rate_route, name="rate_route"),
    path("routes/<int:route_id>/favorite/", views.toggle_favorite, name="toggle_favorite"),
    path("routes/<int:route_id>/comment/", views.add_route_comment, name="add_route_comment"),
    
    # Точки
    path("points/<int:point_id>/comment/", views.add_point_comment, name="add_point_comment"),

    # Сохраненные места
    path("places/", views.saved_places, name="saved_places"),
    path("places/add/", views.add_saved_place, name="add_saved_place"),
    
    # Карта
    path("map/", views.map_view, name="map_view"),

    # Поиск
    path("search/", views.search_routes, name="search"),
]

# Добавляем обработку статических файлов для разработки
from django.conf import settings
from django.conf.urls.static import static

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
 