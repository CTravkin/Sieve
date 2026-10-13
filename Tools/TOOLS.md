# Инструменты Sieve

## Проба раннего обхода

`Probe/` создает диагностический плагин и отдельные синтетические хранилища. Проба исключает заданные префиксы, а не разбирает синтаксис Syncthing. Полный matcher остается этапом 2. Фильтр пробы предназначен для desktop-адаптера; mobile возвращает unsupported, пока его контракт не исследован отдельно.

Runtime активируется только с явным `probeFixture: true` в data.json, который записывает генератор. Установочный пакет не содержит этот конфиг: случайная установка в обычный vault не включает hooks или фильтрацию. Не переносить конфиг fixture в рабочее хранилище.

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run build:probe
npm.cmd run probe:fixture
```

Сборка находится в `dist/sieve-probe/`; `identity.json` содержит Git SHA, признак измененных исходников, версию toolchain и SHA-256 устанавливаемых файлов. Повторная компиляция не повышает номер сборки. В runtime импортируется только `obsidian`.

Генератор создает новый `Local/.temp/SieveProbe/<UTC timestamp>/` с Baseline, Filtered и Descendant, отдельными Profiles и неизменяемым inventory исходных документов. Оригинальные vault и общий профиль Obsidian не используются. Вариант Descendant сохраняет `Technical/deep/keep.md` и его контейнеры. Для увеличения числа технических файлов: `npm.cmd run probe:fixture -- 10000`.

Desktop запускать с отдельными `--user-data-dir`, `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=9229` через скрытый процесс. До испытания убедиться, что приложение открыло только синтетический vault. Не останавливать чужие процессы Obsidian. Отчет нативного renderer:

```powershell
node.exe Tools/Probe/inspect.mjs 9229 <new-report-file.json>
```

На Windows последовательный запуск, включение пробы в отдельном профиле, полный перезапуск, отчет и штатное завершение:

```powershell
& .\Tools\Probe\run-desktop.ps1 -RunDirectory <run-directory> -Variant Baseline
& .\Tools\Probe\run-desktop.ps1 -RunDirectory <run-directory> -Variant Filtered
& .\Tools\Probe\run-desktop.ps1 -RunDirectory <run-directory> -Variant Descendant
```

Restricted mode хранится в localStorage профиля. Наличие Sieve в `community-plugins.json` само по себе не включает community plugins. `inspect.mjs` с последним аргументом `activate`, `disable` или `quit` работает только внутри созданных fixtures; он проверяет vault и профиль по нативному приложению. Обычное выключение требует переоткрытия для восстановления полного индекса. Неизмеренный startup выводится как `observedStartup: false`, счетчик I/O — null.

Это инструментирование нативного Obsidian через локальный debugger, без browser QA. Запись отчета отказывается перезаписывать существующий файл. Debugger закрывается вместе с тестовым процессом; постоянные настройки общего приложения не изменяются.

На iPhone/iPad пакет можно установить только в отдельный тестовый vault. Команда Sieve `Export probe report` сохраняет отчет в `<configDir>/plugins/sieve/probe-report.json`. Пока это отчет о жизненном цикле и неподдержанном desktop-адаптере, а не доказательство mobile pruning. Native watcher/I/O, resume и provider требуют отдельной проверки.

Примерные пути в командах подставлять из `run.json`; не подставлять пользовательские vault. Проверка хешей inventory и полный platform gate обязательны до общего go. Автоматические тесты hooks не заменяют нативный trace.
