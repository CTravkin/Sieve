# Инструменты Sieve

## Приватный runtime

`npm.cmd run build` собирает реальный плагин из `src/main.ts` в `dist/sieve/`. Manifest, идентификация сборки, upstream notices, лицензии и covered source копируются вместе с main.js. Пакет не публикуется автоматически. Сборка проверяет, что внешние filesystem imports относятся только к desktop provider.

`node Tools/Runtime/fixture.mjs 1000` создает шесть отдельных хранилищ в `Local/.temp/SieveProbe/Runtime-<UTC timestamp>/`. Baseline/Filtered/Descendant используют полный matcher; First/Last проверяют порядок с отдельным observer, Alternate — `.sieve-config`. Observer ограничен сгенерированными vault/profile и не входит в пакет плагина.

`Tools/Runtime/run-desktop.ps1 -RunDirectory <run> -Variant Filtered` сначала включает community plugins только в своем профиле, затем полностью переоткрывает vault и сохраняет startup trace. Для следующих запусков этого же профиля есть `-AlreadyEnabled`. Выбирается отдельный user-data-dir; debugger доступен только на 127.0.0.1:9229. Существующий Obsidian или занятый порт запрещают запуск, чужие процессы не останавливаются.

При alternate configDir запускатель сначала сохраняет override и переоткрывает профиль, затем включает плагин уже из выбранного каталога. Activation допускает одно переподключение после нативного reload renderer и проверяет фактическую загрузку перед штатным выходом.

`node Tools/Runtime/verify-fixture.mjs <run> <new-report.json>` проверяет SHA-256 всех исходных документов в вариантах. Файл inventory и marker run.json не изменяются. Временные профили/документы очищаются после завершения всей разработки, когда компактные доказательства уже сохранены.

`node Tools/Runtime/events.mjs <new-report.json>` работает с уже открытым Filtered fixture. Проверяет нативный редактор с положительным контролем autosave, переносы скрыть→скрыть→показать, Unicode/NBSP и реальное удаление открытого скрытого файла. Тест удаляет только собственные имена. Загрузка профиля и CDP дополнительно проверяют realpath, чтобы junction/symlink не вывел тест за границы fixture.

`Tools/Runtime/benchmark.ps1 -RunDirectory <run> -Samples 5` чередует пять Baseline/Filtered запусков уже включенных профилей. Сохраняет I/O, vault.load, renderer layout, CPU и memory после layout. Это полное переоткрытие приложения с прогретыми OS/metadata caches; UI Reading files и отдельный compile timer не измеряются. Сумма максимальной памяти отдельных процессов не является одновременным пиком всего приложения.

`Tools/package-private.ps1` упаковывает только inventory проверенного `dist/sieve`, сверяет каждый hash до и после ZIP, требует совпадающий committed Git SHA и чистую сборку. Запись только в `dist/`, существующий ZIP не перезаписывается. Измененная installable source-сборка требует роста версии и номера; неизмененная повторная сборка сохраняет их.

Счетчики observer относятся к I/O адаптера после его загрузки; интервал vault.load не является UI «Reading files» или полным cold-start benchmark. Truncated/incomplete trace не превращается в нулевой счетчик. Native mobile и другие desktop-приложения проверяются отдельно.

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

## Benchmark в одном доверенном профиле

`Tools/Runtime/benchmark-same-vault.ps1` предназначен для Task 6 после native gate Task 5. Использует только `Filtered` vault/profile выбранного generated runtime run; community plugins должны быть уже доверены и включены вручную. Baseline сохраняет включенный Sieve с пустыми rules, Filtered — `Technical`; у обоих режимов пустой alias. Инструмент не включает restricted mode, не обходит trust и не автоматизирует reload-диалог.

```powershell
& .\Tools\Runtime\benchmark-same-vault.ps1 -RunDirectory <runtime-run> -ExpectedIdentityPath <current-dist-or-installed-identity.json> -Samples 5 -NewTechnicalFiles 10000
node.exe --test Tests/RuntimeBenchmark/*.test.mjs
```

`ExpectedIdentityPath` обязателен: текущие installed identity и hashes сверяются с явной identity и актуальным `dist/sieve`; историческая identity из `run.json` не подменяется после upgrade. До запуска проверяются lexical/physical границы, exact vault/profile, original source hashes, порядок observer/Sieve, отсутствие другого Obsidian и свободный 9229. Native preflight должен подтвердить applied working settings без fallback/pending reload до добавления файлов.

До Start-Process фиксируются verified paths и уникальный launch nonce; PID/creation time добавляются сразу после запуска. Неизменяемая привязка остается в памяти контроллера и связывается с аргументом `--sieve-benchmark-launch`. Отдельный quit-only CDP путь сверяет OS PID/creation time/executable/profile/владельца порта и renderer ancestry, затем фактический `app.getPath('userData')`. Он не читает текущие marker/run/registry/evidence/source и не ожидает vault adapter/plugins/layout. Неверная привязка сохраняет чужой процесс; trust не меняется.

После штатного выхода добавляются только новые `Technical/Bench-<phase>/group-*/hidden-*.md`; суммарный source corpus ограничен 20000 файлами. Новые файлы остаются до отдельной очистки fixture. Исходные `inventory.json` и `run.json` сохраняются. `Reports/Benchmark-<UTC>/` содержит extension plan, отдельные original/added/phase inventories, снимки identity/source/observer/instrumentation/rules/config и ровно заданные alternating Baseline/Filtered пары. Сводка читает только собственную фазу, а не последние отчеты по маске.

Каждая пара — полный restart того же приложения и профиля с прогретым OS cache и сохраненным metadata cache. После расширения корпуса выполняется один отдельный warm-up каждого режима; warm-up отчеты не входят в измеряемые пары. Rules меняются через `plugin.saveSettings`, затем normal quit. Metadata ожидается по реальному `app.metadataCache.isCacheClean()` с ограниченным таймаутом; timestamp первой clean observation берется из renderer `performance.now`. Incomplete/dropped trace, timeout, drift identity/source/corpus, неравный ожидаемый index/metadata или менее пяти пар не дают PASS. Trace cap не меняется; overflow требует отдельного изменения owned observer с новой доказанной instrumentation identity.

CPU и working set снимаются сразу после возврата native report. Полный hash census выполняется после снимка и normal quit, отдельным `complete-sample`; prelaunch census намеренно прогревает OS cache. Metrics содержат phase/pair/mode/sampleKind, startup report digest, launch nonce/PID tree, metadata UTC и monotonic timestamp, время начала/конца snapshot и delta. Валидатор отклоняет неправильную привязку, snapshot до metadata, неверную последовательность census и окно больше 5000 ms. Delta/duration — диагностика инструмента, не ускорение приложения.

Сумма индивидуальных peak working sets не является одновременным пиком приложения. OS I/O trace, rules compile и UI Reading files остаются `null`; OS-cold запуск не заявляется. `summary.json` означает валидность сопоставимых данных, а не прохождение всех платформенных гейтов Task 6. После API restore выполняется новый полный reopen и подтверждение original saved/active settings, applied status без fallback/pending и clean metadata; без `restore-confirmation.json` PASS запрещен. Сравниваются значения и raw SHA до/после, поскольку штатная сериализация может изменить байты JSON. При сбое выполняется попытка restore и normal quit без forced kill; неподтвержденный recovery не выдается за восстановленный working run.
