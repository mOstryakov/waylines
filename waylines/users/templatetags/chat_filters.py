from django import template

register = template.Library()


@register.filter
def get_item(dictionary, key):
<<<<<<< HEAD:waylines/routes/templatetags/chat_filters.py
    """Получить значение из словаря по ключу в шаблоне"""
    return dictionary.get(key, 0)
=======
    return dictionary.get(key, 0)
>>>>>>> b9978dec6f885f7f1edad6b616c2b0c64d4cc5b8:waylines/users/templatetags/chat_filters.py
