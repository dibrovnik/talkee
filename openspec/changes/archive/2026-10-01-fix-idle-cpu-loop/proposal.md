# Proposal

## Why
В простое установленная Talkee занимает 119% CPU, WebKit виджета — 89%. Причина — цикл рендер → повторная инициализация окна → событие якоря → рендер.

## What Changes
- Стабилизировать объект окна в useWidgetController через lazy useState.
- Добавить проверку регрессии и сравнить CPU release-сборок.
- Сохранить горячие клавиши, прогрев модели, восстановление окна и переключение представления.

## Capabilities
### New Capabilities
Нет.
### Modified Capabilities
Нет: восстанавливается существующий Idle resource budget из performance, требования не меняются.

## Impact
src/windows/widget/hooks/useWidgetController.ts и тест регрессии. Без новых зависимостей и изменения API.
