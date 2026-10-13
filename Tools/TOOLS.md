# Инструменты Sieve

## Проба раннего обхода

`Probe/` создает диагностический плагин и отдельные синтетические хранилища. Проба исключает заданные префиксы, а не разбирает синтаксис Syncthing. Полный matcher остается этапом 2. Фильтр пробы предназначен для desktop-адаптера; mobile возвращает unsupported, пока его контракт не исследован отдельно.

Runtime активируется только с явным `probeFixture: true` в data.json, который записывает генератор. Установочный пакет не содержит этот конфиг: случайная установка в обычный vault не включает hooks или фильтрацию. Не переносить конфиг fixture в рабочее хранилище.

## Oracle общего matcher

[Oracle](Oracle/README.md) фиксирует Syncthing 2.1.6 и сравнивает parser, четыре флага, Unicode и pruning с его нативными библиотеками. Команды из корня: `npm.cmd run typecheck`, `npm.cmd run test:core`, `npm.cmd run test:oracle`. Требуется Go 1.27.0 для локальной сборки oracle; уже собранный binary можно явно передать через `SIEVE_ORACLE_BINARY`. Для запуска без esbuild на удаленном хосте используются оба модуля `dist/core/` и `SIEVE_CORE_PREBUILT=1`.

`build:core` создает ESM matcher и normalizer без внешних runtime imports. `runner.mjs` сохраняет binary с fingerprint исходников и PID в `Local/.temp/Oracle/`; каждый запрос создает и очищает только собственный fixture. При завершении разработки удалить оставшиеся принадлежащие задаче binary, копии upstream, fixture/profile и временные remote-пакеты после сохранения компактных отчетов. Общие Go/npm caches и чужие временные каталоги в очистку не включаются. Отчеты разработки, QA, review и ops принадлежат общим каталогам CJA PC.

## Запуск desktop-пробы

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run build:probe
npm.cmd run probe:fixture
```

Сборка находится в `dist/sieve-probe/`; `identity.json` содержит Git SHA, признак измененных исходников, версию toolchain и SHA-256 устанавливаемых файлов. Повторная компиляция не повышает номер сборки. В runtime импортируется только `obsidian`.

Генератор создает новый `Local/.temp/SieveProbe/<UTC timestamp>/` с шестью vault, отдельными Profiles и неизменяемым inventory исходных документов. Baseline/Filtered сравнивают обход; Descendant сохраняет `Technical/deep/keep.md` и его контейнеры. SieveFirst/SieveLast загружают отдельный sentinel после/до Sieve; Alternate использует `.sieve-config`. Оригинальные vault и общий профиль Obsidian не используются. Для увеличения числа технических файлов: `npm.cmd run probe:fixture -- 10000`.

Desktop запускать с отдельными `--user-data-dir`, `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=9229` через скрытый процесс. До испытания убедиться, что приложение открыло только синтетический vault. Не останавливать чужие процессы Obsidian. Отчет нативного renderer:

```powershell
node.exe Tools/Probe/inspect.mjs 9229 <new-report-file.json>
```

На Windows последовательный запуск, включение пробы в отдельном профиле, полный перезапуск, отчет и штатное завершение:

```powershell
& .\Tools\Probe\run-desktop.ps1 -RunDirectory <run-directory> -Variant Baseline
& .\Tools\Probe\run-desktop.ps1 -RunDirectory <run-directory> -Variant Filtered
& .\Tools\Probe\run-desktop.ps1 -RunDirectory <run-directory> -Variant Descendant
& .\Tools\Probe\run-desktop.ps1 -RunDirectory <run-directory> -Variant SieveFirst
& .\Tools\Probe\run-desktop.ps1 -RunDirectory <run-directory> -Variant SieveLast
& .\Tools\Probe\run-desktop.ps1 -RunDirectory <run-directory> -Variant Alternate
```

Restricted mode хранится в localStorage профиля. Наличие Sieve в `community-plugins.json` само по себе не включает community plugins. `native-client.mjs` ожидает готовность нативного renderer, vault и layout в пределах таймаута и проверяет vault/profile по текущему приложению. `inspect.mjs` поддерживает `activate`, `disable`, `quit` и `config-dir <directory>` только внутри fixtures; Alternate выбирает override в отдельном профиле и переоткрывается. Обычное выключение требует переоткрытия для восстановления полного индекса. Незавершенный, ошибочный или усеченный startup выводится как `observedStartup: false`, счетчик I/O — null. `vaultLoadDurationMs` измеряет только вызов vault.load и не заменяет метрику UI Reading files.

События проверяются на уже открытом отфильтрованном fixture:

```powershell
node.exe Tools/Probe/events.mjs <new-event-report.json>
node.exe Tools/Probe/verify-fixture.mjs <run-directory> <new-hash-report.json>
```

`events.mjs` проверяет create/save/rename файла и папки, сохранение через удержанную ссылку после переноса в исключенное поддерево, внешние события и binary attachment. Он отказывается использовать уже существующие тестовые имена, удаляет только созданные тестом файлы/пустые каталоги и записывает результаты, включая FAIL. `verify-fixture.mjs` сверяет все исходные документы с inventory, не изменяя их. Во время event-проверки direct read/write хоста разрешены; их нельзя считать запрещенным scanner I/O.

Это инструментирование нативного Obsidian через локальный debugger, без browser QA. Запись отчета отказывается перезаписывать существующий файл. Debugger закрывается вместе с тестовым процессом; постоянные настройки общего приложения не изменяются.

На iPhone/iPad пакет можно установить только в отдельный тестовый vault. Команда Sieve `Export probe report` сохраняет отчет в `<configDir>/plugins/sieve/probe-report.json`. Пока это отчет о жизненном цикле и неподдержанном desktop-адаптере, а не доказательство mobile pruning. Native watcher/I/O, resume и provider требуют отдельной проверки.

Примерные пути в командах подставлять из `run.json`; не подставлять пользовательские vault. Проверка хешей inventory и полный platform gate обязательны до общего go. Автоматические тесты hooks не заменяют нативный trace.
