from django.urls import path

from . import views

app_name = "ai_audio"

urlpatterns = [
    # Генерация аудио для точек
    path(
        "generate/<int:point_id>/", views.generate_audio, name="generate_audio"
    ),
    path(
        "status/<int:generation_id>/",
        views.get_audio_status,
        name="audio_status",
    ),
    path(
        "delete/<int:generation_id>/", views.delete_audio, name="delete_audio"
    ),
    path("profiles/", views.get_voice_profiles, name="voice_profiles"),
    # Аудио для маршрутов
    path(
        "generate-full/<int:route_id>/",
        views.generate_route_audio,
        name="generate_route_audio",
    ),
    path(
        "status-full/<int:route_id>/",
        views.get_route_audio_status,
        name="route_audio_status",
    ),
    path(
        "generate-all-points/<int:route_id>/",
        views.generate_all_points_audio,
        name="generate_all_points_audio",
    ),
    path(
        "points-status/<int:route_id>/",
        views.get_route_points_audio_status,
        name="route_points_audio_status",
    ),
]
