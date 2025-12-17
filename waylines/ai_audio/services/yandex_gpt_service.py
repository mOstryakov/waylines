import time
import requests
import json
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

class YandexGPTService:
    def __init__(self):
        self.api_key = getattr(settings, "YANDEX_API_KEY", None)
        self.folder_id = getattr(settings, "YANDEX_FOLDER_ID", None)
        
        if not self.api_key or self.api_key == "your-yandex-key-here":
            raise ImproperlyConfigured(
                "YANDEX_API_KEY не задан в настройках. "
                "Добавьте в settings.py: YANDEX_API_KEY = 'ваш_ключ_от_яндекс_облака'"
            )
        
        if not self.folder_id:
            raise ImproperlyConfigured(
                "YANDEX_FOLDER_ID не задан в настройках. "
                "Добавьте в settings.py: YANDEX_FOLDER_ID = 'ваш_folder_id'"
            )

    def generate_location_description(self, lat: float, lng: float, address: str = "", style: str = "storytelling") -> str:
        """
        Генерирует текст экскурсии о месте по координатам
        
        Args:
            lat: Широта
            lng: Долгота
            address: Адрес (если известен)
            style: Стиль описания (storytelling, historical, touristic, poetic, scientific)
        
        Returns:
            Сгенерированный текст
        """
        start_time = time.time()
        
        # Определяем стиль описания
        style_prompts = {
            "storytelling": "рассказ как от живого гида",
            "historical": "историческое повествование с акцентом на историю места",
            "touristic": "описание для туристов с практической информацией",
            "poetic": "поэтическое и художественное описание места",
            "scientific": "научное и фактологическое описание"
        }
        
        style_desc = style_prompts.get(style, "рассказ как от живого гида")
        
        # Системный промпт
        system_prompt = f"""Ты профессиональный гид и экскурсовод. Создай увлекательный текст экскурсии о месте в стиле {style_desc}.
        
        Структура текста:
        2. Основное описание: что это за место, его особенности
        3. Интересные факты и история (если известны)
        4. Что можно увидеть/сделать на месте
        5. Советы посетителям
        6. Завершение
        
        Будь естественным, говори от первого лица как гид. Используй живую речь.
        Длина: 250-400 слов.
        """
        
        # Пользовательский промпт
        user_prompt = f"""Создай текст экскурсии о месте по координатам:
        Широта: {lat}
        Долгота: {lng}
        Адрес: {address if address else 'не указан'}
        
        Если известен конкретный адрес - используй его для более точного описания.
        Если это известное место - расскажи о его истории и значении.
        Если это обычная локация - опиши её атмосферу и окружение.
        
        Важно: Сделай текст живым и увлекательным, как будто гид прямо сейчас ведёт экскурсию на этом месте!"""
        
        try:
            response = requests.post(
                "https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
                headers={
                    "Authorization": f"Api-Key {self.api_key}",
                    "x-folder-id": self.folder_id,
                    "Content-Type": "application/json"
                },
                json={
                    "modelUri": f"gpt://{self.folder_id}/yandexgpt-lite",
                    "completionOptions": {
                        "stream": False,
                        "temperature": 0.7,
                        "maxTokens": 2000
                    },
                    "messages": [
                        {
                            "role": "system",
                            "text": system_prompt
                        },
                        {
                            "role": "user",
                            "text": user_prompt
                        }
                    ]
                },
                timeout=30
            )
            
            if response.status_code != 200:
                raise Exception(f"Ошибка Yandex GPT ({response.status_code}): {response.text[:200]}")
            
            result = response.json()
            generated_text = result["result"]["alternatives"][0]["message"]["text"]
            
            # Логируем статистику
            processing_time = time.time() - start_time
            print(f"✅ Yandex GPT: Сгенерирован текст за {processing_time:.2f} сек, {len(generated_text)} символов")
            
            return generated_text
            
        except Exception as e:
            print(f"❌ Ошибка Yandex GPT: {e}")
            
            # Fallback: локальная генерация если API недоступно
            return self._generate_fallback_description(lat, lng, address, style)
    
    def _generate_fallback_description(self, lat: float, lng: float, address: str, style: str) -> str:
        """Fallback генерация описания если API недоступно"""
        
        # Простое описание на основе координат
        coord_text = f"Координаты: {lat:.6f}, {lng:.6f}"
        
        if address:
            location_text = f"Это место находится по адресу: {address}"
        else:
            location_text = "Это интересное место с живописными окрестностями."
        
        # Базовые описания в разных стилях
        descriptions = {
            "storytelling": f"""Приветствую вас на этой уникальной локации! Меня зовут Матвей, и я буду вашим гидом сегодня.

{location_text} {coord_text}

Представьте, что мы стоим прямо здесь, и перед нами открывается удивительный вид. Это место обладает особой атмосферой, которая притягивает путешественников.

Интересный факт: многие посетители отмечают, что здесь чувствуется особая энергетика и умиротворение.

Что можно сделать на этом месте:
• Насладиться окружающими видами
• Сделать памятные фотографии
• Просто отдохнуть и подышать свежим воздухом

Совет от гида: Лучше всего посещать это место в утренние или вечерние часы, когда освещение наиболее выигрышное.

Надеюсь, вам понравилась наша небольшая виртуальная экскурсия. Обязательно посетите это место вживую!""",
            
            "historical": f"""Место с координатами {coord_text} имеет свою историю и значение.

{location_text}

Исторический контекст этой локации уходит корнями в прошлое. Хотя точные исторические данные могут варьироваться, подобные места часто играли важную роль в развитии региона.

Архитектурные и природные особенности свидетельствуют о различных исторических периодах, которые пережила эта территория.

Для исследователей и любителей истории это место представляет особый интерес как часть культурного ландшафта.""",
            
            "touristic": f"""Туристическая точка: {coord_text}

{location_text}

Для путешественников это место предлагает:
✓ Возможность увидеть локальные достопримечательности
✓ Точку для ориентации на местности
✓ Место для отдыха во время экскурсий

Инфраструктура в районе этой точки обеспечивает базовые удобства для туристов. Рекомендуется иметь с собой карту или навигатор.

Идеально подходит для:
• Пеших прогулок
• Фотографирования
• Изучения окрестностей""",
            
            "poetic": f"""Здесь, на {coord_text}, время замедляет свой бег...

{location_text}

Каждый камень, каждый изгиб ландшафта хранит свою историю. Это место дышит тишиной и покоем, приглашая остановиться и задуматься.

Природа вокруг создает уникальную композицию света и тени, особенно красиво здесь на рассвете и закате.

Это не просто точка на карте, а источник вдохновения и умиротворения."""
        }
        
        return descriptions.get(style, descriptions["storytelling"])