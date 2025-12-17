__all__ = ()

import json
import logging
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.shortcuts import get_object_or_404
from django.core.files.base import ContentFile
from django.utils.translation import gettext as _
from .models import AudioGeneration
from routes.models import RoutePoint
from .services.tts_service import TTSService
from .services.yandex_gpt_service import YandexGPTService

logger = logging.getLogger(__name__)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def generate_audio(request, point_id):
    point = get_object_or_404(RoutePoint, id=point_id, route__author=request.user)

    try:
        data = json.loads(request.body)
        text = (data.get("text") or point.description).strip()
        if not text:
            return JsonResponse({"error": _("Text is empty")}, status=400)

        voice_type = data.get("voice_type", "alloy")
        voice = data.get("voice", "ermil")
        language = "ru"
        expressiveness = int(data.get("expressiveness", 50))
        emotion = data.get("emotion", "neutral")
        speed = data.get("speed", 1.0)
        pitch = data.get("pitch", 0)
        format = data.get("format", "mp3")

        tts = TTSService()
        audio_content, processing_time = tts.generate_audio(
            text=text,
            language=language,
            voice_type=voice_type,
            expressiveness=expressiveness,
            voice=voice,
            emotion=emotion,
            speed=speed,
            pitch=pitch,
            format=format
        )

        audio_gen = AudioGeneration.objects.create(
            point=point,
            user=request.user,
            text_content=text,
            voice_type=voice_type,
            language=language,
            status="completed",
            processing_time=processing_time
        )

        filename = f"audio_guide_{point.id}_{audio_gen.id}.{format}"
        audio_gen.audio_file.save(filename, ContentFile(audio_content))
        audio_gen.save()

        point.audio_guide = audio_gen.audio_file
        point.save()

        route = point.route
        route.has_audio_guide = True
        route.save()

        return JsonResponse({
            "status": "success",
            "audio_url": audio_gen.audio_file.url,
        })

    except Exception as e:
        logger.error(f"Audio generation error: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def generate_location_description(request, point_id):
    point = get_object_or_404(RoutePoint, id=point_id, route__author=request.user)

    try:
        data = json.loads(request.body)
        style = data.get("style", "storytelling")

        lat = getattr(point, 'latitude', None) or data.get("lat")
        lng = getattr(point, 'longitude', None) or data.get("lng")

        if lat is None or lng is None:
            return JsonResponse({
                "error": _("Coordinates not found"),
                "hint": _("Ensure the point has latitude and longitude fields")
            }, status=400)

        address = getattr(point, 'address', '') or ""

        gpt_service = YandexGPTService()
        description = gpt_service.generate_location_description(
            lat=float(lat),
            lng=float(lng),
            address=address,
            style=style
        )

        if data.get("save_to_point", False):
            point.description = description
            point.save()

        return JsonResponse({
            "status": "success",
            "description": description,
            "point_id": point_id,
            "coordinates": f"{lat}, {lng}",
            "address": address,
            "style": style
        })

    except Exception as e:
        logger.error(f"Description generation error: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@login_required
@require_http_methods(["GET"])
def get_audio_status(request, generation_id):
    audio_gen = get_object_or_404(AudioGeneration, id=generation_id, user=request.user)
    return JsonResponse({
        "status": "completed",
        "audio_url": audio_gen.audio_file.url if audio_gen.audio_file else None,
    })


@csrf_exempt
@login_required
@require_http_methods(["DELETE"])
def delete_audio(request, generation_id):
    audio_gen = get_object_or_404(AudioGeneration, id=generation_id, user=request.user)
    if audio_gen.audio_file:
        audio_gen.audio_file.delete(save=False)
    audio_gen.delete()
    return JsonResponse({"status": "success"})