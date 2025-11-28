from django.contrib import messages
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm
from django.db.models import Q
from django.shortcuts import render, get_object_or_404, redirect

from routes.models import Route, RouteFavorite
from users.forms import UserProfileForm, UserRegistrationForm
from users.models import Friendship, UserProfile, User


@login_required
def friends(request):
    friendships = Friendship.objects.filter(
        Q(from_user=request.user) | Q(to_user=request.user), status="accepted"
    )

    friends = []
    for friendship in friendships:
        if friendship.from_user == request.user:
            friend = friendship.to_user
        else:
            friend = friendship.from_user
        
        friend.public_active_route_count = Route.objects.filter(
            author=friend, 
            privacy="public", 
            is_active=True
        ).count()
        friends.append(friend)

    context = {
        "friends": friends,
        "pending_friend_requests": Friendship.objects.filter(
            to_user=request.user, status="pending"
        ),
        "pending_requests_count": Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count(),
        "shared_routes_count": 0,
    }
    return render(request, "friends/friends.html", context)


@login_required
def remove_friend(request, friend_id):
    friend = get_object_or_404(User, id=friend_id)
    
    friendship = Friendship.objects.filter(
        (Q(from_user=request.user, to_user=friend) | Q(from_user=friend, to_user=request.user)),
        status="accepted"
    ).first()
    
    if friendship:
        friendship.delete()
        messages.success(request, f"Пользователь {friend.username} удален из друзей")
    else:
        messages.error(request, "Дружба не найдена")
    
    return redirect("friends")


@login_required
def send_message(request, user_id):
    recipient = get_object_or_404(User, id=user_id)
    
    # Проверяем, что пользователь действительно друг
    is_friend = Friendship.objects.filter(
        (Q(from_user=request.user, to_user=recipient) | Q(from_user=recipient, to_user=request.user)),
        status="accepted"
    ).exists()
    
    if not is_friend:
        messages.error(request, "Вы можете отправлять сообщения только своим друзьям")
        return redirect("friends")
    
    # Перенаправляем в личный чат с другом
    return redirect('chat:private_chat', user_id=user_id)


@login_required
def find_friends(request):
    """Поиск друзей"""
    search_query = request.GET.get("q", "")
    users = User.objects.exclude(id=request.user.id)

    if search_query:
        users = users.filter(
            Q(username__icontains=search_query)
            | Q(first_name__icontains=search_query)
            | Q(last_name__icontains=search_query)
        )

    user_data = []
    for user in users[:20]:
        friendship = Friendship.objects.filter(
            Q(from_user=request.user, to_user=user)
            | Q(from_user=user, to_user=request.user)
        ).first()

        user_data.append(
            {
                "user": user,
                "friendship_status": friendship.status if friendship else None,
            }
        )

    context = {
        "users": user_data,
        "pending_friend_requests": Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5],
        "pending_requests_count": Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count(),
    }
    return render(request, "friends/find_friends.html", context)


@login_required
def send_friend_request(request, user_id):
    to_user = get_object_or_404(User, id=user_id)

    existing_request = Friendship.objects.filter(
        Q(from_user=request.user, to_user=to_user)
        | Q(from_user=to_user, to_user=request.user)
    ).first()

    if existing_request:
        messages.info(request, "Запрос в друзья уже существует")
    else:
        Friendship.objects.create(from_user=request.user, to_user=to_user)
        messages.success(
            request,
            f"Запрос в друзья отправлен пользователю {to_user.username}",
        )

    return redirect("find_friends")


@login_required
def accept_friend_request(request, request_id):
    friend_request = get_object_or_404(Friendship, id=request_id, to_user=request.user)
    friend_request.status = "accepted"
    friend_request.save()

    messages.success(
        request,
        f"Вы приняли запрос в друзья от {friend_request.from_user.username}",
    )
    return redirect("friends")


@login_required
def reject_friend_request(request, request_id):
    friend_request = get_object_or_404(Friendship, id=request_id, to_user=request.user)
    friend_request.status = "rejected"
    friend_request.save()

    messages.info(
        request,
        f"Вы отклонили запрос в друзья от {friend_request.from_user.username}",
    )
    return redirect("friends")


@login_required
def profile(request):
    profile, created = UserProfile.objects.get_or_create(user=request.user)

    if request.method == "POST":
        form = UserProfileForm(request.POST, request.FILES, instance=profile)
        if form.is_valid():
            form.save()
            messages.success(request, "Профиль обновлен")
            return redirect("profile")
    else:
        form = UserProfileForm(instance=profile)

    user_routes = Route.objects.filter(author=request.user)
    user_favorites = RouteFavorite.objects.filter(user=request.user)

    context = {
        "form": form,
        "profile": profile,
        "routes_count": user_routes.count(),
        "favorites_count": user_favorites.count(),
        "total_distance": sum(route.total_distance for route in user_routes),
        "recent_routes": user_routes.order_by('-created_at')[:5],
        "friends_count": Friendship.objects.filter(
            Q(from_user=request.user) | Q(to_user=request.user),
            status="accepted"
        ).count(),
        "pending_friend_requests": Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5],
        "pending_requests_count": Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count(),
    }
    return render(request, "profile/profile.html", context)


def user_profile(request, username):
    user = get_object_or_404(User, username=username)
    public_routes = Route.objects.filter(author=user, privacy="public", is_active=True)

    context = {
        "profile_user": user,
        "public_routes": public_routes,
    }

    if request.user.is_authenticated:
        context["pending_friend_requests"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5]
        context["pending_requests_count"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count()

    return render(request, "profile/user_profile.html", context)


# Аутентификация
def register(request):
    if request.method == "POST":
        form = UserRegistrationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            messages.success(request, "Регистрация прошла успешно!")
            return redirect("home")
    else:
        form = UserRegistrationForm()

    return render(request, "registration/register.html", {"form": form})


def login_view(request):
    if request.method == "POST":
        form = AuthenticationForm(request, data=request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)
            messages.success(request, f"Добро пожаловать, {user.username}!")
            return redirect("home")
    else:
        form = AuthenticationForm()

    return render(request, "registration/login.html", {"form": form})


def logout_view(request):
    logout(request)
    messages.info(request, "Вы вышли из системы")
    return redirect("home")
