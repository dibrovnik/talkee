# Tasks

## 1. Исправление цикла
- [x] 1.1 Стабилизировать Window в src/windows/widget/hooks/useWidgetController.ts и добавить src/windows/widget/hooks/useWidgetController.test.ts; проверить bun test src/windows/widget/hooks/useWidgetController.test.ts.
- [x] 1.2 Проверить типы: bunx tsc --noEmit.

## 2. Интеграция
- [x] 2.1 Собрать подписанный release через bun run build:release:macos и замерить CPU за 60 секунд в простое, записать результат в design.md.
- [x] 2.2 Проверить bun run gate.
