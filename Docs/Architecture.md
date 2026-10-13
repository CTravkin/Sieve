# Архитектурная проба Sieve

Промежуточная проверка этапа 1, 13.10.2026. Полный matcher и UI еще не реализованы; общий go не объявлен.

## Проверенный desktop-кандидат

На нативном Windows Obsidian API 1.14.4 заранее включенная community-проба завершает async `onload` до первого `vault.load`. В пробе подготовка задерживалась на 100 ms; журнал подтвердил hooks-ready → onload-end → vault-load-start → adapter.listAll → layout-ready.

Desktop-адаптер содержит `listAll`, `listRecursive`, `listRecursiveChild(parent, name)`, `reconcileFile(realPath, normalizedPath)` и `reconcileFileInternal(realPath, normalizedPath)`. Mobile-метод `watchAndList` отсутствует на desktop: проверять его как общий capability нельзя.

Instance guards `listRecursiveChild` и `reconcileFile` отсекают путь до raw; дополнительный guard `reconcileFileInternal` — до lstat. `fsPromises` клонируется только для инструментирования данного адаптера, общий node:fs не меняется. Direct read/write не фильтруются. При unload свои свойства восстанавливаются; сохраненный чужим wrapper hook становится неактивным.

Временный классификатор работает по префиксам fixture и явному разрешенному потомку. Он сохраняет необходимые контейнеры. Это проверка точки интеграции, а не реализация Syncthing или его CanSkipDir. Production matcher остается самостоятельным этапом с native oracle.

## Нативное наблюдение

Три одинаковых synthetic vault содержат по 2104 исходных документа: 2001 в Technical, 103 вне него; дополнительно есть папки-контейнеры. Во всех вариантах используются собственные профиль и конфигурация, без подключения пользовательского vault.

| Сценарий | I/O адаптера внутри Technical | Объекты индекса всего | Объекты metadata | Technical в индексе |
| --- | ---: | ---: | ---: | --- |
| Baseline, проба только наблюдает | 2045 | 2129 | 2104 | 2023 объекта |
| Полное отсечение Technical | 0 | 106 | 103 | 0 |
| Разрешен Technical/deep/keep.md | 5 | 109 | 104 | Две папки и разрешенный файл |
| Sieve выключен, vault переоткрыт | Не инструментировано | 2129 | 2104 | 2023 объекта |

Полное отсечение проверено после предыдущего нефильтрованного запуска: старые metadata не вернули исключенные пути. После отключения без переоткрытия индекс оставался отфильтрованным; полный перезапуск восстановил baseline. 6312 SHA-256 исходных документов в трех vault совпали с inventory. Установленный obsidian.asar не изменялся.

Счетчики относятся к `fsPromises` адаптера после установки hooks. Это не трассировка всех системных вызовов ОС, сторонних плагинов или native watcher. Проверочные повторные запуски не являются контролируемым cold/warm benchmark; ускорение в процентах не заявляется.

Raw отчеты и inventory находятся в игнорируемом `Local/.temp/SieveProbe/2026-10-13T20-24-47-623Z/`. Финальная проба `0.2.0 (2)`, SHA-256 main.js `abd985e02968e8a1f27b6b39ff3a23ee517ee0980068c1e0f14b64b823f95dce`. Финальные отчеты: `Reports/2026-10-13T20-42-52-703Z-Baseline-startup.json`, `Reports/2026-10-13T20-42-59-618Z-Filtered-startup.json`, `Reports/2026-10-13T20-43-05-927Z-Descendant-startup.json`. `filtered-native.json` и `filtered-recovery.json` относятся к раннему кандидату с историческим путем `Local/Data/Probe`; raw содержимое сохранено. Процедуры — [Tools](../Tools/TOOLS.md).

Первоначально fixtures создавались в Local/Data, который допускается текущими правилами Projects Syncthing. Созданные этой задачей файлы перемещены в Local/.temp, исключенный первым правилом каталогов с точкой. Правила sync не менялись. Успевшая репликация исходного временного пути на устройства не проверялась; данные полностью синтетические.

## Оставшиеся гейты

Нужны две очередности community plugins, repeated cold/warm измерения, OS/native watcher trace, alternate configDir, реальные события/create/save/rename, проверка alias и native mobile fast/fallback/resume. Наличие Linux-хостов не подтверждает доступность desktop GUI. iPhone/iPad доступны по сообщению Constantine; native проверка еще не выполнена. Android/macOS не проверены. Основную реализацию начинать только после принятия архитектурного гейта из [плана](../Plans/Development.md).
