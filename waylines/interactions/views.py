import logging
import traceback

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.http import JsonResponse

from routes.models import Route
from interactions.models import Comment, Favorite, Rating

logger = logging.getLogger(__name__)


@login_required
def toggle_favorite(request, route_id):
    try:
        route = get_object_or_404(Route, id=route_id)
        favorite, created = Favorite.objects.get_or_create(
            user=request.user, route=route
        )

        if not created:
            favorite.delete()
            messages.success(request, "Удалено из избранного")
            logger.info(
                f"Пользователь {request.user.username} удалил маршрут"
                f" {route_id} из избранного"
            )
        else:
            messages.success(request, "Добавлено в избранное")
            logger.info(
                f"Пользователь {request.user.username} добавил "
                f"маршрут {route_id} в избранное"
            )

        return redirect(
            request.META.get(
                "HTTP_REFERER", reverse("route_detail", args=[route_id])
            )
        )
    except Exception as e:
        logger.error(f"Ошибка в toggle_favorite: {str(e)}")
        logger.error(traceback.format_exc())
        messages.error(request, "Произошла ошибка при работе с избранным")
        return redirect("route_detail", pk=route_id)


@login_required
def add_rating(request, route_id):
    try:
        if request.method == "POST":
            route = get_object_or_404(Route, id=route_id)
            score = request.POST.get("score", "")

            if not score.isdigit():
                messages.error(request, "Некорректная оценка")
                return redirect("route_detail", pk=route_id)

            score = int(score)

            if 1 <= score <= 5:
                Rating.objects.update_or_create(
                    user=request.user, route=route, defaults={"score": score}
                )
                messages.success(request, f"Вы поставили оценку {score}")
                logger.info(
                    f"Пользователь {request.user.username} поставил "
                    f"оценку {score} маршруту {route_id}"
                )
            else:
                messages.error(request, "Оценка должна быть от 1 до 5")

        return redirect(
            request.META.get(
                "HTTP_REFERER", reverse("route_detail", args=[route_id])
            )
        )
    except Exception as e:
        logger.error(f"Ошибка в add_rating: {str(e)}")
        logger.error(traceback.format_exc())
        messages.error(request, "Произошла ошибка при оценке маршрута")
        return redirect("route_detail", pk=route_id)


@login_required
def my_favorites(request):
    try:
        favorites = request.user.favorite_routes.all()
        return render(
            request, "interactions/my_favorites.html", {"favorites": favorites}
        )
    except Exception as e:
        logger.error(f"Ошибка в my_favorites: {str(e)}")
        logger.error(traceback.format_exc())
        messages.error(request, "Произошла ошибка при загрузке избранного")
        return redirect("home")


@login_required
def add_comment(request, route_id):
    try:
        print("\n=== DEBUG: Начало add_comment ===")
        print(f"route_id: {route_id}")
        print(f"Пользователь: {request.user.username}")

        if request.method != "POST":
            print("DEBUG: Неверный метод запроса")
            if request.headers.get("X-Requested-With") == "XMLHttpRequest":
                return JsonResponse(
                    {"success": False, "error": "Неверный метод запроса"},
                    status=405,
                )
            return redirect("route_detail", pk=route_id)

        print("DEBUG: Получаем маршрут...")
        try:
            route = Route.objects.get(id=route_id)
            print(f"DEBUG: Маршрут найден: {route.name}")
            print(
                f"DEBUG: Автор маршрута: {route.author.username}, "
                f"ID: {route.author.id}"
            )
        except Route.DoesNotExist:
            print("DEBUG: Маршрут не найден")
            if request.headers.get("X-Requested-With") == "XMLHttpRequest":
                return JsonResponse(
                    {"success": False, "error": "Маршрут не найден"},
                    status=404,
                )
            messages.error(request, "Маршрут не найден")
            return redirect("home")

        text = request.POST.get("text", "").strip()
        print(f"DEBUG: Текст комментария: '{text}'")

        if not text:
            print("DEBUG: Пустой комментарий")
            if request.headers.get("X-Requested-With") == "XMLHttpRequest":
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Комментарий не может быть пустым",
                    },
                    status=400,
                )
            messages.error(request, "Комментарий не может быть пустым")
            return redirect("route_detail", pk=route_id)

        print("DEBUG: Создаем комментарий...")
        try:
            comment = Comment.objects.create(
                route=route, user=request.user, text=text
            )
            print(f"DEBUG: Комментарий создан, ID={comment.id}")
        except Exception as e:
            print(f"DEBUG: Ошибка при создании комментария: {str(e)}")
            raise

        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            print("DEBUG: Это AJAX запрос")
            try:
                comments = route.interaction_comments.all().order_by(
                    "created_at"
                )
                comments_count = comments.count()
                print(f"DEBUG: Всего комментариев: {comments_count}")

                html_parts = []
                for i, cmt in enumerate(comments):
                    can_delete = cmt.user == request.user
                    is_author = cmt.user == route.author
                    delete_button = ""

                    if can_delete:
                        delete_button = f"""<button type="button"
                        class="btn btn-link text-danger p-0 btn-sm opacity-75
                        hover-opacity-100 delete-comment-btn"
                                data-comment-id="{cmt.id}" title="Удалить">
                            <i class="far fa-trash-alt"></i>
                        </button>
                        """

                    # МЕТКА АВТОРА МАРШРУТА
                    author_badge = ""
                    if is_author:
                        author_badge = """
                        <span class="badge bg-light text-muted border px-2
                         py-1 ms-2" style="font-size: 0.65rem;
                          font-weight: 500;">
                            <i class="fas fa-feather-alt me-1"></i>Автор
                        </span>
                        """

                    border_class = (
                        "border-bottom" if i < comments_count - 1 else ""
                    )

                    # ISO формат времени для JavaScript
                    iso_time = cmt.created_at.isoformat()

                    server_time = cmt.created_at.strftime("%d.%m.%Y %H:%M")

                    html_parts.append(
                        f"""<div class="comment-item d-
                        flex mb-3 pb-3 {border_class}"
                    data-comment-id="{cmt.id}"
                         data-user-id="{cmt.user.id}"
                         data-timestamp="{iso_time}">
                        <div class="flex-shrink-0">
                            <div class="avatar-placeholder rounded-circle
                             bg-light d-flex align-items-center justify-
                             content-center border" style="width: 40px;
                              height: 40px;">
                                <i class="fas fa-user text-secondary"></i>
                            </div>
                        </div>
                        <div class="flex-grow-1 ms-3">
                            <div class="d-flex justify-content-between
                             align-items-start">
                                <div>
                                    <div class="d-flex align-items-center
                                     gap-2 mb-1"><h6 class="mb-0 text-dark
                                        fw-bold">{cmt.user.username}</h6>
                                        {author_badge}
                                    </div>
                                    <small class="text-muted comment-time"
                                     data-timestamp=
                                     "{iso_time}">{server_time}</small>
                                </div>
                                {delete_button}
                            </div>
                            <p class="comment-text text-secondary mt-2 mb-0"
                             style="white-space: pre-line;">{cmt.text}</p>
                        </div>
                    </div>
                    """
                    )

                if comments_count == 0:
                    html = """
                    <div class="text-center py-4 text-muted">
                        <i class="far fa-comment-dots fa-3x mb-3
                         opacity-25"></i>
                        <p class="mb-0">Комментариев пока нет.
                         Будьте первым!</p>
                    </div>
                    """
                else:
                    html = "".join(html_parts)

                print(f"DEBUG: HTML сгенерирован успешно, длина: {len(html)}")

                return JsonResponse(
                    {
                        "success": True,
                        "html": html,
                        "comments_count": comments_count,
                        "message": "Комментарий успешно добавлен",
                    }
                )

            except Exception as e:
                print(f"DEBUG: Ошибка при генерации HTML: {str(e)}")
                import traceback

                traceback.print_exc()
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Ошибка при обновлении комментариев",
                        "debug": str(e),
                    },
                    status=500,
                )

        print("DEBUG: Обычный запрос, перенаправляем...")
        messages.success(request, "Комментарий добавлен")
        return redirect("route_detail", pk=route_id)

    except Exception as e:
        print("\n=== DEBUG: КРИТИЧЕСКАЯ ОШИБКА ===")
        print(f"Тип ошибки: {type(e).__name__}")
        print(f"Сообщение: {str(e)}")
        import traceback

        traceback.print_exc()

        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            return JsonResponse(
                {
                    "success": False,
                    "error": "Внутренняя ошибка сервера",
                    "debug": f"{type(e).__name__}: {str(e)}",
                },
                status=500,
            )

        messages.error(request, "Произошла ошибка при добавлении комментария")
        return redirect("route_detail", pk=route_id)


@login_required
def delete_comment(request, comment_id):
    try:
        print("\n=== DEBUG: Начало delete_comment ===")
        print(f"comment_id: {comment_id}")

        if request.method != "POST":
            print("DEBUG: Неверный метод запроса")
            if request.headers.get("X-Requested-With") == "XMLHttpRequest":
                return JsonResponse(
                    {"success": False, "error": "Неверный метод запроса"},
                    status=405,
                )
            return redirect("home")

        print("DEBUG: Получаем комментарий...")
        comment = get_object_or_404(Comment, id=comment_id)
        print(
            f"DEBUG: Комментарий найден, пользователь: {comment.user.username}"
        )

        if comment.user != request.user:
            print(
                f"DEBUG: Нет прав на удаление. Владелец: {comment.user}, "
                f"запросил: {request.user}"
            )
            if request.headers.get("X-Requested-With") == "XMLHttpRequest":
                return JsonResponse(
                    {"success": False, "error": "Нет прав на удаление"},
                    status=403,
                )
            messages.error(request, "Нет прав на удаление комментария")
            return redirect("route_detail", pk=comment.route.id)

        route = comment.route
        print(f"DEBUG: Удаляем комментарий к маршруту: {route.name}")
        print(
            f"DEBUG: Автор маршрута: {route.author.username}, ID: "
            f"{route.author.id}"
        )

        comment.delete()
        print("DEBUG: Комментарий удален")

        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            print("DEBUG: Это AJAX запрос")
            try:
                comments = route.interaction_comments.all().order_by(
                    "created_at"
                )
                comments_count = comments.count()
                print(f"DEBUG: Осталось комментариев: {comments_count}")

                html_parts = []
                for i, cmt in enumerate(comments):
                    can_delete = cmt.user == request.user
                    is_author = cmt.user == route.author
                    delete_button = ""

                    if can_delete:
                        delete_button = f"""
                        <button type="button" class="btn btn-link text-danger
                         p-0 btn-sm opacity-75 hover-opacity-
                         100 delete-comment-btn"
                         data-comment-id="{cmt.id}" title="Удалить">
                            <i class="far fa-trash-alt"></i>
                        </button>
                        """

                    # МЕТКА АВТОРА МАРШРУТА
                    author_badge = ""
                    if is_author:
                        author_badge = """
                        <span class="badge bg-light text-muted border px-2
                         py-1 ms-2" style="font-size: 0.65rem;
                          font-weight: 500;">
                            <i class="fas fa-feather-alt me-1"></i>Автор
                        </span>
                        """

                    border_class = (
                        "border-bottom" if i < comments_count - 1 else ""
                    )

                    # ISO формат времени для JavaScript
                    iso_time = cmt.created_at.isoformat()

                    server_time = cmt.created_at.strftime("%d.%m.%Y %H:%M")

                    html_parts.append(
                        f"""
                    <div class="comment-item d-flex mb-3 pb-3 {border_class}"
                         data-comment-id="{cmt.id}"
                         data-user-id="{cmt.user.id}"
                         data-timestamp="{iso_time}">
                        <div class="flex-shrink-0">
                            <div class="avatar-placeholder rounded-circle
                             bg-light d-flex align-items-center
                             justify-content-center border"
                              style="width: 40px; height: 40px;">
                                <i class="fas fa-user text-secondary"></i>
                            </div>
                        </div>
                        <div class="flex-grow-1 ms-3">
                            <div class="d-flex justify-content
                            -between align-items-start">
                                <div>
                                    <div class="d-flex align-items-
                                    center gap-2 mb-1">
                                        <h6 class="mb-0 text-dark fw-
                                        bold">{cmt.user.username}</h6>
                                        {author_badge}
                                    </div>
                                    <small class="text-muted comment-time"
                                     data-timestamp=
                                     "{iso_time}">{server_time}</small>
                                </div>
                                {delete_button}
                            </div>
                            <p class="comment-text text-secondary mt-2 mb-0"
                             style="white-space: pre-line;">{cmt.text}</p>
                        </div>
                    </div>
                    """
                    )

                if comments_count == 0:
                    html = """
                    <div class="text-center py-4 text-muted">
                        <i class="far fa-comment-dots fa-3x
                         mb-3 opacity-25"></i>
                        <p class="mb-0">Комментариев
                         пока нет. Будьте первым!</p>
                    </div>
                    """
                else:
                    html = "".join(html_parts)

                return JsonResponse(
                    {
                        "success": True,
                        "html": html,
                        "comments_count": comments_count,
                        "message": "Комментарий успешно удален",
                    }
                )

            except Exception as e:
                print(f"DEBUG: Ошибка при генерации HTML: {str(e)}")
                import traceback

                traceback.print_exc()
                return JsonResponse(
                    {
                        "success": False,
                        "error": "Ошибка при обновлении комментариев",
                        "debug": str(e),
                    },
                    status=500,
                )

        print("DEBUG: Обычный запрос, перенаправляем...")
        messages.success(request, "Комментарий удален")
        return redirect("route_detail", pk=route.id)

    except Exception as e:
        print("\n=== DEBUG: КРИТИЧЕСКАЯ ОШИБКА В delete_comment ===")
        print(f"Тип ошибки: {type(e).__name__}")
        print(f"Сообщение: {str(e)}")
        import traceback

        traceback.print_exc()

        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            return JsonResponse(
                {
                    "success": False,
                    "error": "Внутренняя ошибка сервера",
                    "debug": f"{type(e).__name__}: {str(e)}",
                },
                status=500,
            )

        messages.error(request, "Произошла ошибка при удалении комментария")
        return redirect("home")
