from celery import shared_task
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from routes.models import RoutePoint, Route
from .models import AudioGeneration, RouteAudioGuide, VoiceProfile
from .services.tts_service import TTSService
from .services.audio_combiner import AudioCombiner
import logging

logger = logging.getLogger(__name__)


@shared_task
def generate_point_audio(point_id, voice_type="alloy", language="auto"):
    """Фоновая задача для генерации аудио точки"""
    try:
        point = RoutePoint.objects.get(id=point_id)
        text = point.description.strip()

        if not text:
            logger.warning(
                f"Точка {point_id} не имеет описания для генерации аудио"
            )
            return

        # Создаем запись о генерации
        audio_gen = AudioGeneration.objects.create(
            point=point,
            user=point.route.author,
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
        filename = f"point_{point.id}_{voice_type}.mp3"
        audio_gen.audio_file.save(filename, ContentFile(audio_content))
        audio_gen.status = "completed"
        audio_gen.processing_time = processing_time
        audio_gen.save()

        # Обновляем точку маршрута
        point.audio_guide = audio_gen.audio_file
        point.save()

        logger.info(f"Аудио для точки {point_id} успешно сгенерировано")

    except Exception as e:
        logger.error(f"Ошибка генерации аудио для точки {point_id}: {e}")
        # Обновляем статус ошибки
        AudioGeneration.objects.filter(
            point_id=point_id, status="processing"
        ).update(status="failed", error_message=str(e))


@shared_task
def generate_route_audio_guide(route_id):
    """Генерация полного аудиогида для маршрута"""
    try:
        route = Route.objects.get(id=route_id)
        points = route.points.filter(audio_guide__isnull=False).order_by(
            "order"
        )

        if not points.exists():
            logger.warning(f"Нет точек с аудио для маршрута {route_id}")
            return

        # Создаем или получаем запись аудиогида маршрута
        route_audio, created = RouteAudioGuide.objects.get_or_create(
            route=route
        )
        route_audio.status = "processing"
        route_audio.total_points = points.count()
        route_audio.save()

        # Объединяем аудиофайлы точек
        audio_combiner = AudioCombiner()
        combined_audio = audio_combiner.combine_route_audio(points, route.name)

        # Сохраняем объединенный файл
        filename = f"route_{route.id}_full_guide.mp3"
        route_audio.audio_file.save(filename, ContentFile(combined_audio))
        route_audio.status = "completed"
        route_audio.save()

        logger.info(f"Полный аудиогид для маршрута {route_id} создан")

    except Exception as e:
        logger.error(f"Ошибка создания аудиогида для маршрута {route_id}: {e}")
        RouteAudioGuide.objects.filter(route_id=route_id).update(
            status="failed"
        )
