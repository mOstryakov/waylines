from django.contrib import messages
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm
from django.db.models import Q, Count, Sum
from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404, redirect
from django.utils import timezone
from django.utils.translation import gettext

from routes.models import Route, RouteFavorite
from users.models import Friendship, UserProfile, User


def _get_friend_status(user, target):
    if user == target:
        return "self"
    qs = Friendship.objects.filter(
        (Q(from_user=user, to_user=target) | Q(from_user=target, to_user=user))
    )
    if not qs.exists():
        return "none"
    obj = qs.first()
    if obj.status == "accepted":
        return "friend"
    if obj.from_user == user and obj.status == "pending":
        return "sent"
    if obj.to_user == user and obj.status == "pending":
        return "received"
    return "none"


@login_required
def friends(request):
    friendships = Friendship.objects.filter(
        Q(from_user=request.user) | Q(to_user=request.user),
        status="accepted"
    ).select_related("from_user", "to_user")

    friends_list = []
    for f in friendships:
        friend = f.to_user if f.from_user == request.user else f.from_user
        count = Route.objects.filter(author=friend, privacy="public", is_active=True).count()
        friend.public_active_route_count = count
        friends_list.append(friend)

    pending_requests = Friendship.objects.filter(
        to_user=request.user, status="pending"
    ).select_related("from_user")[:5]

    return render(request, "friends/friends.html", {
        "friends": friends_list,
        "pending_friend_requests": pending_requests,
        "pending_requests_count": len(pending_requests),
        "shared_routes_count": 0,
    })


@login_required
def remove_friend(request, friend_id):
    friend = get_object_or_404(User, id=friend_id)
    friendship = Friendship.objects.filter(
        (Q(from_user=request.user, to_user=friend) |
         Q(from_user=friend, to_user=request.user)),
        status="accepted"
    ).first()

    if friendship:
        friendship.delete()
        messages.success(
            request,
            gettext("User %(username)s has been removed from your friends") % {"username": friend.username}
        )
    else:
        messages.error(request, gettext("Friendship not found"))

    return redirect("friends")


@login_required
def send_message(request, user_id):
    recipient = get_object_or_404(User, id=user_id)
    if not Friendship.objects.filter(
        (Q(from_user=request.user, to_user=recipient) |
         Q(from_user=recipient, to_user=request.user)),
        status="accepted"
    ).exists():
        messages.error(request, gettext("You can only send messages to your friends"))
        return redirect("friends")

    return redirect("chat:private_chat", user_id=user_id)


@login_required
def find_friends(request):
    search_query = request.GET.get("q", "").strip()
    users = User.objects.exclude(id=request.user.id)

    if search_query:
        users = users.filter(
            Q(username__icontains=search_query) |
            Q(first_name__icontains=search_query) |
            Q(last_name__icontains=search_query)
        )

    user_data = []
    for user in users[:20]:
        friendship = Friendship.objects.filter(
            Q(from_user=request.user, to_user=user) |
            Q(from_user=user, to_user=request.user)
        ).first()
        user_data.append({
            "user": user,
            "friendship_status": friendship.status if friendship else None,
        })

    pending_requests = Friendship.objects.filter(
        to_user=request.user, status="pending"
    ).select_related("from_user")[:5]

    return render(request, "friends/find_friends.html", {
        "users": user_data,
        "pending_friend_requests": pending_requests,
        "pending_requests_count": len(pending_requests),
    })


@login_required
def send_friend_request(request, user_id):
    to_user = get_object_or_404(User, id=user_id)
    if to_user == request.user:
        messages.error(request, gettext("You cannot send a friend request to yourself"))
        return redirect("find_friends")

    if Friendship.objects.filter(
        Q(from_user=request.user, to_user=to_user) |
        Q(from_user=to_user, to_user=request.user)
    ).exists():
        messages.info(request, gettext("A friend request already exists"))
    else:
        Friendship.objects.create(from_user=request.user, to_user=to_user)
        messages.success(
            request,
            gettext("Friend request sent to %(username)s") % {"username": to_user.username}
        )

    return redirect("find_friends")


@login_required
def accept_friend_request(request, request_id):
    friend_request = get_object_or_404(Friendship, id=request_id, to_user=request.user)
    friend_request.status = "accepted"
    friend_request.save()
    messages.success(
        request,
        gettext("You have accepted the friend request from %(username)s") % {"username": friend_request.from_user.username}
    )
    return redirect("friends")


@login_required
def reject_friend_request(request, request_id):
    friend_request = get_object_or_404(Friendship, id=request_id, to_user=request.user)
    friend_request.status = "rejected"
    friend_request.save()
    messages.info(
        request,
        gettext("You have declined the friend request from %(username)s") % {"username": friend_request.from_user.username}
    )
    return redirect("friends")


@login_required
def profile(request):
    profile, _ = UserProfile.objects.get_or_create(user=request.user)

    can_change_username = True
    username_change_days_left = None
    if profile.last_username_change:
        days_since = (timezone.now() - profile.last_username_change).days
        can_change_username = days_since >= 30
        if not can_change_username:
            username_change_days_left = 30 - days_since

    if request.method == "POST":
        email = request.POST.get("email")
        first_name = request.POST.get("first_name", "")
        last_name = request.POST.get("last_name", "")
        username = request.POST.get("username")

        username_changed = False
        if username and username != request.user.username:
            if not can_change_username:
                messages.error(request, gettext("Имя пользователя можно менять только раз в 30 дней"))
                return redirect("profile")
            if User.objects.filter(username=username).exclude(id=request.user.id).exists():
                messages.error(request, gettext("Это имя пользователя уже занято"))
                return redirect("profile")
            request.user.username = username
            username_changed = True

        if email and email != request.user.email:
            request.user.email = email
        request.user.first_name = first_name
        request.user.last_name = last_name
        request.user.save()

        profile.bio = request.POST.get("bio", "")
        profile.location = request.POST.get("location", "")
        profile.website = request.POST.get("website", "")

        if username_changed:
            profile.last_username_change = timezone.now()

        if "avatar" in request.FILES:
            profile.avatar = request.FILES["avatar"]
        elif request.POST.get("remove_avatar") == "1":
            if profile.avatar:
                profile.avatar.delete(save=False)
                profile.avatar = None

        profile.save()
        messages.success(request, gettext("Профиль успешно обновлен"))
        return redirect("profile")

    user_routes = Route.objects.filter(author=request.user)
    total_distance = user_routes.aggregate(
        total=Sum("total_distance", filter=Q(total_distance__isnull=False))
    )["total"] or 0

    friendships = Friendship.objects.filter(
        Q(from_user=request.user) | Q(to_user=request.user),
        status="accepted"
    )
    friends_count = friendships.count()

    pending_requests = Friendship.objects.filter(to_user=request.user, status="pending")[:5]

    return render(request, "profile/profile.html", {
        "profile": profile,
        "routes_count": user_routes.count(),
        "favorites_count": RouteFavorite.objects.filter(user=request.user).count(),
        "total_distance": total_distance,
        "recent_routes": user_routes.order_by("-created_at")[:5],
        "friends_count": friends_count,
        "pending_friend_requests": pending_requests,
        "pending_requests_count": len(pending_requests),
        "can_change_username": can_change_username,
        "username_change_days_left": username_change_days_left,
    })


def user_profile(request, username):
    user = get_object_or_404(User, username=username)
    routes_qs = Route.objects.filter(author=user, is_active=True)
    total_distance = routes_qs.aggregate(
        total=Sum("total_distance", filter=Q(total_distance__isnull=False))
    )["total"] or 0

    public_routes = routes_qs.filter(privacy="public").order_by("-created_at")

    user_favorites_ids = []
    if request.user.is_authenticated:
        from interactions.models import Favorite
        user_favorites_ids = list(Favorite.objects.filter(user=request.user).values_list("route_id", flat=True))

    is_friend = friend_request_sent = friend_request_received = False
    friends = []

    if request.user.is_authenticated and request.user != user:
        status = _get_friend_status(request.user, user)
        if status == "friend":
            is_friend = True
        elif status == "sent":
            friend_request_sent = True
        elif status == "received":
            friend_request_received = True

    friendships = Friendship.objects.filter(
        Q(from_user=user) | Q(to_user=user),
        status="accepted"
    ).select_related("from_user", "to_user")

    for f in friendships:
        friends.append(f.to_user if f.from_user == user else f.from_user)

    private_routes = Route.objects.filter(author=user, privacy="private") if request.user == user else []

    context = {
        "profile_user": user,
        "public_routes": public_routes,
        "total_distance": total_distance,
        "user_favorites_ids": user_favorites_ids,
        "is_friend": is_friend,
        "friend_request_sent": friend_request_sent,
        "friend_request_received": friend_request_received,
        "friends": friends[:12],
        "private_routes": private_routes,
    }

    if request.user.is_authenticated:
        pending = Friendship.objects.filter(to_user=request.user, status="pending")
        context.update({
            "pending_friend_requests": list(pending[:5]),
            "pending_requests_count": pending.count(),
        })

    return render(request, "profile/user_profile.html", context)


def register(request):
    if request.method == "POST":
        form = UserRegistrationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            messages.success(request, gettext("Registration successful!"))
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
            messages.success(
                request,
                gettext("Welcome back, %(username)s!") % {"username": user.username}
            )
            return redirect("home")
    else:
        form = AuthenticationForm()
    return render(request, "registration/login.html", {"form": form})


def logout_view(request):
    logout(request)
    messages.info(request, gettext("You have been logged out"))
    return redirect("home")


def _create_notification(user, title, message, obj_type, obj_id):
    try:
        from notifications.models import Notification
        Notification.objects.create(
            user=user,
            title=title,
            message=message,
            notification_type=obj_type,
            related_object_id=obj_id,
            related_object_type="route",
        )
    except ImportError:
        pass


@login_required
def send_to_friend(request, route_id):
    if request.method != "POST":
        return JsonResponse({"success": False, "error": gettext("Invalid request method")})

    route = get_object_or_404(Route, id=route_id)
    if route.author != request.user and not request.user.is_staff:
        return JsonResponse({"success": False, "error": gettext("You do not have permission to share this route")})

    try:
        data = json.loads(request.body)
        friend_id = data.get("friend_id")
        if not friend_id:
            return JsonResponse({"success": False, "error": gettext("No friend selected")})

        friend = get_object_or_404(User, id=friend_id)

        if not Friendship.objects.filter(
            (Q(from_user=request.user, to_user=friend) | Q(from_user=friend, to_user=request.user)),
            status="accepted"
        ).exists():
            return JsonResponse({"success": False, "error": gettext("This user is not your friend")})

        route.shared_with.add(friend)

        _create_notification(
            user=friend,
            title=gettext("Route shared with you"),
            message=gettext('%(sender)s has shared the route "%(route_name)s" with you') % {
                "sender": request.user.username,
                "route_name": route.name
            },
            obj_type="route_shared",
            obj_id=route.id
        )

        friend_name = friend.get_full_name() or friend.username
        return JsonResponse({
            "success": True,
            "message": gettext('Route "%(route_name)s" has been shared with %(name)s') % {
                "route_name": route.name,
                "name": friend_name
            }
        })

    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": gettext("Invalid data format")})
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)})


@login_required
def get_friends_list(request):
    friendships = Friendship.objects.filter(
        Q(from_user=request.user, status="accepted") |
        Q(to_user=request.user, status="accepted")
    ).select_related("from_user", "to_user")

    friends = []
    for f in friendships:
        friend = f.to_user if f.from_user == request.user else f.from_user
        friends.append({
            "id": friend.id,
            "username": friend.username,
            "first_name": friend.first_name,
            "last_name": friend.last_name,
            "email": friend.email,
        })

    return JsonResponse({"success": True, "friends": friends})

@login_required
def check_username_availability(request):
    username = request.GET.get('username', '').strip()
    
    if not username:
        return JsonResponse({'error': gettext('Имя пользователя не может быть пустым')})
    
    # Проверяем, существует ли пользователь с таким именем
    from django.contrib.auth.models import User
    user_exists = User.objects.filter(username=username).exclude(id=request.user.id).exists()
    
    # Также проверяем допустимые символы
    import re
    pattern = re.compile(r'^[a-zA-Z0-9_]+$')
    is_valid = bool(pattern.match(username))
    
    return JsonResponse({
        'exists': user_exists,
        'is_valid': is_valid,
        'username': username
    })