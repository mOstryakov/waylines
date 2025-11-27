from django.urls import path

urlpatterns =
[
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
    # Профиль
    path("profile/", views.profile, name="profile"),
    path("profile/<str:username>/", views.user_profile, name="user_profile"),
    # Аутентификация
    path("register/", views.register, name="register"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
]
