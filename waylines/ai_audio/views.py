import json
import logging
from django.http import JsonResponse
from django.contrib import messages
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.shortcuts import get_object_or_404
from django.contrib.auth.decorators import login_required
from django.core.files.base import ContentFile

from routes.models import Route, RoutePoint
from .models import AudioGeneration, VoiceProfile, RouteAudioGuide
from .services.tts_service import TTSService

logger = logging.getLogger(__name__)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def generate_audio(request, point_id):
    """Генерация аудиогида для точки маршрута"""
    point = get_object_or_404(
        RoutePoint, id=point_id, route__author=request.user
    )

    try:
        data = json.loads(request.body)
        voice_type = data.get("voice_type", "alloy")
        language = data.get("language", "auto")
        text = data.get("text", "") or point.description

        if not text.strip():
            return JsonResponse(
                {"error": "Текст для генерации пуст"}, status=400
            )

        # Создаем запись о генерации
        audio_gen = AudioGeneration.objects.create(
            point=point,
            user=request.user,
            text_content=text,
            voice_type=voice_type,
            language=language,
            status="processing",
        )

        # Генерируем аудио
        tts_service = TTSService()
        audio_content, processing_time = tts_service.generate_audio(
            text, voice_type, language
        )

        # Сохраняем файл
        filename = f"audio_{point.id}_{voice_type}_{language}.mp3"
        audio_gen.audio_file.save(filename, ContentFile(audio_content))
        audio_gen.status = "completed"
        audio_gen.processing_time = processing_time
        audio_gen.save()

        # Обновляем точку маршрута
        point.audio_guide = audio_gen.audio_file
        point.save()

        # Обновляем маршрут - есть аудиогид
        point.route.has_audio_guide = True
        point.route.save()

        return JsonResponse(
            {
                "status": "success",
                "audio_url": audio_gen.audio_file.url,
                "generation_id": audio_gen.id,
                "processing_time": processing_time,
            }
        )

    except Exception as e:
        logger.error(f"Audio generation error: {e}")

        # Обновляем статус ошибки если запись создана
        if "audio_gen" in locals():
            audio_gen.status = "failed"
            audio_gen.error_message = str(e)
            audio_gen.save()

        return JsonResponse({"status": "error", "message": str(e)}, status=500)


@login_required
@require_http_methods(["GET"])
def get_audio_status(request, generation_id):
    """Получение статуса генерации аудио"""
    audio_gen = get_object_or_404(
        AudioGeneration, id=generation_id, user=request.user
    )

    return JsonResponse(
        {
            "status": audio_gen.status,
            "audio_url": (
                audio_gen.audio_file.url if audio_gen.audio_file else None
            ),
            "error_message": audio_gen.error_message,
            "created_at": audio_gen.created_at.isoformat(),
            "completed_at": (
                audio_gen.completed_at.isoformat()
                if audio_gen.completed_at
                else None
            ),
        }
    )


@csrf_exempt
@login_required
@require_http_methods(["DELETE"])
def delete_audio(request, generation_id):
    """Удаление сгенерированного аудио"""
    audio_gen = get_object_or_404(
        AudioGeneration, id=generation_id, user=request.user
    )

    # Удаляем файл если есть
    if audio_gen.audio_file:
        audio_gen.audio_file.delete(save=False)

    audio_gen.delete()

    return JsonResponse({"status": "success", "message": "Аудио удалено"})


@login_required
@require_http_methods(["GET"])
def get_voice_profiles(request):
    """Получение доступных голосов и языков"""
    return JsonResponse(
        {
            "voices": dict(AudioGeneration.VOICE_CHOICES),
            "languages": dict(AudioGeneration.LANGUAGE_CHOICES),
        }
    )


@login_required
@require_http_methods(["POST"])
def generate_route_audio(request, route_id):
    """Принудительная генерация полного аудиогида для маршрута"""
    route = get_object_or_404(Route, id=route_id, author=request.user)

    # Проверяем есть ли точки с аудио
    points_with_audio = route.points.filter(audio_guide__isnull=False)
    if not points_with_audio.exists():
        return JsonResponse(
            {"error": "Нет точек с аудио для создания маршрута"}, status=400
        )

    # Запускаем генерацию
    from .tasks import generate_route_audio_guide

    generate_route_audio_guide.delay(route.id)

    return JsonResponse(
        {
            "status": "started",
            "message": "Генерация полного аудиогида запущена",
            "points_count": points_with_audio.count(),
        }
    )


@login_required
@require_http_methods(["GET"])
def get_route_audio_status(request, route_id):
    route_audio = get_object_or_404(
        RouteAudioGuide, route_id=route_id, route__author=request.user
    )

    return JsonResponse(
        {
            "status": route_audio.status,
            "audio_url": (
                route_audio.audio_file.url if route_audio.audio_file else None
            ),
            "total_points": route_audio.total_points,
            "created_at": route_audio.created_at.isoformat(),
            "updated_at": route_audio.updated_at.isoformat(),
        }
    )


@login_required
@require_http_methods(["POST"])
def generate_all_points_audio(request, route_id):
    route = get_object_or_404(Route, id=route_id, author=request.user)
    points_without_audio = route.points.filter(
        audio_guide__isnull=True, description__isnull=False
    ).exclude(description="")

    if not points_without_audio.exists():
        return JsonResponse(
            {"message": "Все точки уже имеют аудио или не имеют описания"}
        )

    voice_profile, created = VoiceProfile.objects.get_or_create(
        user=request.user,
        defaults={"preferred_voice": "alloy", "preferred_language": "auto"},
    )

    from .tasks import generate_point_audio

    for point in points_without_audio:
        generate_point_audio.delay(
            point.id,
            voice_profile.preferred_voice,
            voice_profile.preferred_language,
        )

    return JsonResponse(
        {
            "status": "started",
            "message": f"Запущена генерация аудио для {points_without_audio.count()} точек",
            "points_count": points_without_audio.count(),
        }
    )


@login_required
@require_http_methods(["GET"])
def get_route_points_audio_status(request, route_id):
    route = get_object_or_404(Route, id=route_id)

    # Проверяем права доступа
    if (
        route.author != request.user
        and not route.shared_with.filter(id=request.user.id).exists()
    ):
        return JsonResponse(
            {"error": "Нет доступа к этому маршруту"}, status=403
        )

    points = route.points.all()
    audio_status = []

    for point in points:
        audio_generations = point.audio_generations.order_by("-created_at")
        latest_generation = (
            audio_generations.first() if audio_generations.exists() else None
        )

        audio_status.append(
            {
                "point_id": point.id,
                "point_name": point.name,
                "has_audio": point.audio_guide is not None,
                "audio_url": (
                    point.audio_guide.url if point.audio_guide else None
                ),
                "latest_generation_status": (
                    latest_generation.status
                    if latest_generation
                    else "not_generated"
                ),
                "latest_generation_error": (
                    latest_generation.error_message
                    if latest_generation
                    else None
                ),
            }
        )

    return JsonResponse(
        {
            "route_id": route.id,
            "route_name": route.name,
            "points_audio_status": audio_status,
            "total_points": points.count(),
            "points_with_audio": len(
                [p for p in audio_status if p["has_audio"]]
            ),
        }
    )
