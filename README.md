# Sieve

[Русский](README.md) · [English](README.en.md)

Плагин Obsidian для исключения файлов и каталогов перед индексацией хранилища.

## Статус

Разработка первой версии. Реализованы общий matcher с нативным oracle, ранний runtime, хранение настроек, UI на русском и английском и отображаемые имена хранилищ. Проверки платформ и производительности продолжаются. Публичного релиза нет.

Версия разработки — `0.6.1 (14)`. Приватный runtime использует полный matcher; историческая диагностическая проба использует классификатор префиксов. Все нативные испытания выполняются в отдельных синтетических хранилищах. [Команды и границы проверки](Tools/TOOLS.md).

## Функции

Согласованный объем: ранняя фильтрация с полным синтаксисом Syncthing, подробная справка и отображаемые имена всех хранилищ в меню переключения. Русский Obsidian использует RU, остальные языки — EN. [Настройки и восстановление](Docs/Settings.md); требования и ограничения описаны в [Requirements](Docs/Requirements.md).

## Платформы

Целевые платформы — Windows, macOS, Linux, iOS и Android. Общий matcher сравнен с Syncthing 2.1.6 на Windows и Linux; native Obsidian-проба проверена на Windows. Это разные проверки. Состояние интеграции отражено в [Compatibility](Docs/Compatibility.md). `minAppVersion: 1.14.4` задает целевой минимум.

## Эксплуатация

### Проверка

Проверки материалов требуют Node.js 22 или новее и не требуют установки зависимостей. Для TypeScript/core нужны `npm.cmd ci`, для native oracle — Go 1.27.0; версии и профили зафиксированы в [Oracle](Tools/Oracle/README.md).

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
npm.cmd run build
```

На других платформах используйте команды npm без `.cmd`. `check`/`test` проверяют материалы и диагностические hooks; `typecheck`/`test:core`/`test:oracle` — общий движок, `test:adapters`/`test:settings` — модели runtime и хранения, `test:ui`/`test:alias` — форму, локализацию и имена. `build` создает приватный пакет в `dist/sieve/`. Native Obsidian, системный I/O и UI требуют отдельных сценариев.

## Ссылки

- [План разработки](Plans/Development.md)
- [Синтаксис фильтров](Docs/Syntax.ru.md)
- [Правила версий и сборок](Docs/Versioning.md)

Лицензия для публичного выпуска будет выбрана отдельно. Репозиторий остается приватным до отдельного решения владельца.
