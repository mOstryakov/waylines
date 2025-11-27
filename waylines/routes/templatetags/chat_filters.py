from django import template

register = template.Library()


@register.filter
def get_item(dictionary, key):
    """Получить значение из словаря по ключу в шаблоне"""
    return dictionary.get(key, 0)
