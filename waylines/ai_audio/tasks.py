from celery import shared_task
from django.core.files.base import ContentFile
from .models import AudioGeneration
from .services.tts_service import TTSService
import logging

logger = logging.getLogger(__name__)

@shared_task
def generate_point_audio_task(generation_id: int):
    try:
        audio_gen = AudioGeneration.objects.get(id=generation_id)
        if audio_gen.status != "queued":
            return

        audio_gen.status = "processing"
        audio_gen.save(update_fields=["status"])

        tts = TTSService()
        audio_content, processing_time = tts.generate_audio(
            text=audio_gen.text_content,
            language="ru"
        )

        filename = f"audio_guide_{audio_gen.point.id}_{audio_gen.id}.mp3"
        audio_gen.audio_file.save(filename, ContentFile(audio_content), save=True)

        audio_gen.status = "completed"
        audio_gen.processing_time = processing_time
        audio_gen.save(update_fields=["status", "audio_file", "processing_time", "completed_at"])

        # Обновляем точку и маршрут
        point = audio_gen.point
        point.audio_guide = audio_gen.audio_file
        point.save(update_fields=["audio_guide"])

        route = point.route
        if not route.has_audio_guide:
            route.has_audio_guide = True
            route.save(update_fields=["has_audio_guide"])

        logger.info(f"✅ Аудио сгенерировано для точки {point.id}")

    except Exception as e:
        logger.error(f"❌ Ошибка генерации аудио {generation_id}: {e}")
        try:
            audio_gen = AudioGeneration.objects.get(id=generation_id)
            audio_gen.status = "failed"
            audio_gen.error_message = str(e)
            audio_gen.save(update_fields=["status", "error_message"])
        except AudioGeneration.DoesNotExist:
            pass