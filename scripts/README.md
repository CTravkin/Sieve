# Сборка и проверки Sieve

Все команды выполняются из корня репозитория. Нужны Node.js >=22 и зависимости из `package-lock.json`; для oracle — Go 1.27.0. [Oracle](Oracle/README.md) фиксирует upstream, toolchain и ограничения платформ.

| Инструмент | Назначение | Запуск | Результаты |
| --- | --- | --- | --- |
| [check-project](check-project.mjs) | Версии, локализация, материалы и ссылки репозитория | `npm.cmd run check` | Отчет проверок |
| [build-core](build-core.mjs) | Переносимые matcher и normalizer без runtime imports | `npm.cmd run build:core` | `dist/core` |
| [build-plugin](build-plugin.mjs) | Плагин, инструкция, лицензии, covered source и идентификация | `npm.cmd run build` | `dist/sieve` |
| [package-private](package-private.ps1) | Приватный ZIP из проверенного inventory | `& .\scripts\package-private.ps1` | Новый ZIP в `dist`; существующий архив не перезаписывается |
| [package-paths](package-paths.ps1) | Проверка физических границ упаковки | Используется упаковщиком | Отказ при выходе за разрешенные границы и reparse |

`npm.cmd ci` устанавливает закрепленные зависимости. Перед коммитом обязательны `npm.cmd run check` и `npm.cmd test`. Общая регрессия — `npm.cmd run test:regression`; упаковка и ее границы — `npm.cmd run test:package`. Core и oracle проверяются через `npm.cmd run test:core` и `npm.cmd run test:oracle`.

Сборщик сверяет fingerprint исходников, импортированной документации, лицензий и build config. Измененные входы требуют новой версии и номера сборки; повторная сборка неизмененных входов их не повышает. Упаковщик требует чистый Git, совпадающий SHA сборки и точный состав, сверяет хеши до записи и после чтения ZIP.

Порядок: проверки, локальный коммит, сборка того же состояния, упаковка. Публикация и установка в пользовательское хранилище выполняются отдельно. Общие тесты не подтверждают нативные UI, I/O и поддержку устройств.
