from django.conf import settings
from django.conf.urls.static import static
from django.urls import path

from . import views

urlpatterns = [
    path("friends/", views.friends, name="friends"),
    path("friends/find/", views.find_friends, name="find_friends"),
    path(
        "friends/send-request/<int:user_id>/",
        views.send_friend_request,
        name="send_friend_request",
    ),
    path(
        "friends/accept-request/<int:request_id>/",
        views.accept_friend_request,
        name="accept_friend_request",
    ),
    path(
        "friends/reject-request/<int:request_id>/",
        views.reject_friend_request,
        name="reject_friend_request",
    ),
    path(
        "friends/remove/<int:friend_id>/",
        views.remove_friend,
        name="remove_friend",
    ),
    path(
        "messages/send/<int:user_id>/",
        views.send_message,
        name="send_message",
    ),
    # Профиль
    path("profile/", views.profile, name="profile"),
    path("profile/<str:username>/", views.user_profile, name="user_profile"),
    # Аутентификация
    path("register/", views.register, name="register"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)