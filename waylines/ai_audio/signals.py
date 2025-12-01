from django.db.models.signals import post_save
from django.dispatch import receiver
from django.db import transaction
from routes.models import RoutePoint
from .models import AudioGeneration, VoiceProfile, RouteAudioGuide
from .services.tts_service import TTSService
from .tasks import generate_point_audio, generate_route_audio_guide
import logging

logger = logging.getLogger(__name__)


@receiver(post_save, sender=RoutePoint)
def auto_generate_point_audio(sender, instance, created, **kwargs):
    if created and instance.description.strip():
        try:
            # Проверяем настройки пользователя
            voice_profile, created = VoiceProfile.objects.get_or_create(
                user=instance.route.author,
                defaults={
                    "preferred_voice": "alloy",
                    "preferred_language": "auto",
                },
            )

            if voice_profile.auto_generate:
                # Запускаем фоновую задачу для генерации
                transaction.on_commit(
                    lambda: generate_point_audio.delay(
                        point_id=instance.id,
                        voice_type=voice_profile.preferred_voice,
                        language=voice_profile.preferred_language,
                    )
                )
                logger.info(
                    f"Автогенерация аудио запущена для точки {instance.id}"
                )

        except Exception as e:
            logger.error(
                f"Ошибка автогенерации аудио для точки {instance.id}: {e}"
            )


@receiver(post_save, sender=AudioGeneration)
def check_route_audio_completion(sender, instance, created, **kwargs):
    if instance.status == "completed" and not instance.is_route_audio:
        point = instance.point
        route = point.route

        # Проверяем сколько точек имеют аудио
        points_with_audio = route.points.filter(
            audio_guide__isnull=False
        ).count()
        total_points = route.points.count()

        # Если все точки имеют аудио - генерируем полный маршрут
        if points_with_audio == total_points and total_points > 0:
            transaction.on_commit(
                lambda: generate_route_audio_guide.delay(route.id)
            )
