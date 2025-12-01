import os
import tempfile
from django.core.files.storage import default_storage
import logging

logger = logging.getLogger(__name__)

try:
    from pydub import AudioSegment

    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False
    logger.warning("pydub not installed. Audio combining will be disabled.")


class AudioCombiner:
    def __init__(self):
        if not PYDUB_AVAILABLE:
            raise Exception(
                "pydub is required for audio combining. Install with: pip install pydub"
            )

        self.intro_duration = 2000  # 2 секунды для интро
        self.pause_duration = 1000  # 1 секунда паузы между точками

    def combine_route_audio(self, points, route_name):
        """Объединяет аудиофайлы точек в один маршрут"""
        try:
            # Создаем интро маршрута
            combined = AudioSegment.silent(duration=self.intro_duration)

            for i, point in enumerate(points, 1):
                if point.audio_guide:
                    try:
                        # Загружаем аудио файл точки
                        point_audio = self.load_audio_file(
                            point.audio_guide.path
                        )

                        # Добавляем паузу перед точкой (кроме первой)
                        if i > 1:
                            combined += AudioSegment.silent(
                                duration=self.pause_duration
                            )

                        # Добавляем аудио точки
                        combined += point_audio

                    except Exception as e:
                        logger.error(
                            f"Ошибка загрузки аудио для точки {point.id}: {e}"
                        )
                        continue

            # Экспортируем в MP3
            output = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
            combined.export(output.name, format="mp3", bitrate="128k")

            with open(output.name, "rb") as f:
                audio_content = f.read()

            # Удаляем временный файл
            os.unlink(output.name)

            return audio_content

        except Exception as e:
            logger.error(f"Ошибка объединения аудио: {e}")
            raise

    def load_audio_file(self, file_path):
        """Загружает аудио файл с поддержкой разных форматов"""
        try:
            if file_path.endswith(".mp3"):
                return AudioSegment.from_mp3(file_path)
            elif file_path.endswith(".wav"):
                return AudioSegment.from_wav(file_path)
            else:
                # Пробуем автоматическое определение
                return AudioSegment.from_file(file_path)
        except Exception as e:
            logger.error(f"Ошибка загрузки файла {file_path}: {e}")
            raise
