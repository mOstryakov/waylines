__all__ = ()

from users.models import Friendship


def navbar_context(request):
    context = {}
    if request.user.is_authenticated:
        context["pending_requests_count"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        ).count()
        context["pending_friend_requests"] = Friendship.objects.filter(
            to_user=request.user, status="pending"
        )[:5]
    return context
