# Sieve

[Русский](README.md) · [English](README.en.md)

Плагин Obsidian для исключения файлов и каталогов перед индексацией хранилища.

## Статус

Разработка первой версии. Реализованы общий matcher с нативным oracle, ранний runtime, хранение настроек, UI на русском и английском и отображаемые имена хранилищ. Проверки платформ и производительности продолжаются. Публичного релиза нет.

Версия разработки — `0.6.6 (19)`. Приватный runtime использует полный matcher; диагностические пробы и benchmark находятся в рабочей области разработчика. Все нативные испытания выполняются в отдельных синтетических хранилищах.

## Функции

Согласованный объем: ранняя фильтрация с полным синтаксисом Syncthing, подробная справка и отображаемые имена всех хранилищ в меню переключения. Русский Obsidian использует RU, остальные языки — EN. [Настройки и восстановление](Docs/Settings.md); полная справка доступна в [Docs](Docs/README.md).

## Платформы

Целевые платформы — Windows, macOS, Linux, iOS и Android. Общий matcher сравнен с Syncthing 2.1.6 на Windows и Linux; native Obsidian-проба проверена на Windows. Это разные проверки. Полная нативная приемка всех платформ еще не завершена. `minAppVersion: 1.14.4` задает целевой минимум.

## Эксплуатация

### Проверка

Проверки материалов требуют Node.js 22 или новее и не требуют установки зависимостей. Для TypeScript/core нужны `npm.cmd ci`, для native oracle — Go 1.27.0; версии и профили зафиксированы в [Oracle](scripts/Oracle/README.md).

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:core
npm.cmd run test:oracle
npm.cmd run test:adapters
npm.cmd run test:settings
npm.cmd run test:ui
npm.cmd run test:alias
npm.cmd run test:regression
npm.cmd run build
```

На других платформах используйте команды npm без `.cmd`. `check`/`test` проверяют материалы репозитория; `typecheck`/`test:core`/`test:oracle` — общий движок, `test:adapters`/`test:settings` — модели runtime и хранения, `test:ui`/`test:alias` — форму, локализацию и имена. `build` создает приватный пакет в `dist/sieve/`. Native Obsidian, системный I/O и UI требуют отдельных сценариев.

Сборка и упаковка описаны в [scripts](scripts/README.md).

## Ссылки

- [Синтаксис фильтров](Docs/Syntax.ru.md)
- [Приватная установка и обновление](Docs/Private-Package.md)

Лицензия для публичного выпуска будет выбрана отдельно. Репозиторий остается приватным до отдельного решения владельца.
