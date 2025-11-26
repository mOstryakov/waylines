from django.shortcuts import get_object_or_404, redirect, render
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.urls import reverse
from routes.models import Route
from interactions.models import Comment, Favorite, Rating


@login_required
def toggle_favorite(request, route_id):
    route = get_object_or_404(Route, id=route_id)
    favorite, created = Favorite.objects.get_or_create(
        user=request.user, route=route
    )

    if not created:
        favorite.delete()
        messages.success(request, "Удалено из избранного")
    else:
        messages.success(request, "Добавлено в избранное")

    return redirect(request.META.get("HTTP_REFERER", reverse("route_detail", args=[route_id])))


@login_required
def add_rating(request, route_id):
    if request.method == "POST":
        route = get_object_or_404(Route, id=route_id)
        score = int(request.POST.get("score", 0))

        if 1 <= score <= 5:
            Rating.objects.update_or_create(
                user=request.user, route=route, defaults={"score": score}
            )
            messages.success(request, f"Вы поставили оценку {score}")

    return redirect(request.META.get("HTTP_REFERER", reverse("route_detail", args=[route_id])))


@login_required
def my_favorites(request):
    favorites = request.user.favorite_routes.all()
    return render(
        request, "interactions/my_favorites.html", {"favorites": favorites}
    )


@login_required
def add_comment(request, route_id):
    if request.method == "POST":
        route = get_object_or_404(Route, id=route_id)
        text = request.POST.get("text", "").strip()

        if text:
            Comment.objects.create(user=request.user, route=route, text=text)
            messages.success(request, "Комментарий добавлен")
        else:
            messages.error(request, "Комментарий не может быть пустым")

    return redirect(request.META.get("HTTP_REFERER", reverse("route_detail", args=[route_id])))


@login_required
def delete_comment(request, comment_id):
    comment = get_object_or_404(Comment, id=comment_id, user=request.user)
    route_id = comment.route.id
    comment.delete()
    messages.success(request, "Комментарий удален")
    return redirect(request.META.get("HTTP_REFERER", reverse("route_detail", args=[route_id])))
