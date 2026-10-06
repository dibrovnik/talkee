#!/usr/bin/env python3
"""Local cleanup evaluation for polish-daily-workflow task 3.6.

Runs the production Russian cleanup prompt (classic style, temperature 0,
max_tokens 1024, stream=false -- exactly what ai.rs sends to a local endpoint)
against the bundled talkee-llm sidecar and scores the results by hand-written
expectations.

Usage:

    # 1. start the bundled runtime with an installed GGUF
    ./src-tauri/target/release/talkee-llm \
        -m "$HOME/Library/Application Support/com.talkee.app/models/llm/Qwen3-1.7B-Q4_K_M.gguf" \
        --host 127.0.0.1 --port 18090 -c 4096 --jinja

    # 2. dump the production prompt (see the change design for the one-off test)
    cargo test --manifest-path src-tauri/Cargo.toml dump_cleanup_prompt_for_eval --lib

    # 3. score it
    python3 scripts/eval-local-cleanup.py [--port 18090] [--model Qwen3-1.7B-Q4_K_M]

The script only talks to 127.0.0.1 and never downloads anything: it evaluates the
models that are already installed.
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
import urllib.request
from pathlib import Path

PROMPT_PATH = Path("/tmp/talkee_cleanup_prompt_ru.txt")
SUFFIX = "\nВерни только исправленный текст без пояснений."
MAX_TOKENS = 1024
TEMPERATURE = 0.0

# (id, category, raw dictation, must_appear, must_not_appear, exact)
CASES: list[tuple[str, str, str, list[str], list[str], str | None]] = [
    # The classic style is deliberately conservative about filler words: keeping
    # an ambiguous "короче" is allowed, so only the content is asserted.
    (
        "fillers",
        "слова-паразиты",
        "Ну, э-э, короче, я думаю, что, типа, это надо сделать сегодня.",
        ["надо сделать сегодня"],
        [],
        None,
    ),
    (
        "numbers",
        "числа",
        "Бюджет составляет два миллиона триста тысяч рублей на двадцать пятый год.",
        ["два миллиона триста тысяч", "двадцать пятый"],
        [],
        None,
    ),
    (
        "names",
        "имена",
        "Передай привет Александру Сергеевичу и Марии Петровне.",
        ["Александру Сергеевичу", "Марии Петровне"],
        [],
        None,
    ),
    (
        "selfcorrection",
        "самокоррекция",
        "Встреча в среду, нет, в четверг, в четыре часа.",
        ["четверг"],
        [],
        None,
    ),
    (
        "tech_terms",
        "технические термины",
        "Нужно поднять кубернетис кластер и настроить постгрес с редисом.",
        ["кластер"],
        [],
        None,
    ),
    (
        "ru_en_mix",
        "смешанный RU/EN",
        "Сделай деплой на стейджинг через CI/CD пайплайн, потом посмотрим логи.",
        ["деплой", "CI/CD", "логи"],
        [],
        None,
    ),
    (
        "already_clean",
        "уже чистый текст",
        "Сегодня мы обсудили план релиза и договорились о сроках.",
        ["обсудили план релиза", "договорились о сроках"],
        [],
        "Сегодня мы обсудили план релиза и договорились о сроках.",
    ),
    (
        "typo_fix",
        "опечатка распознавания",
        "Севодня открой настройки и проверь синхронизацию.",
        ["Сегодня"],
        ["Севодня"],
        None,
    ),
    (
        "stutter_preserve",
        "сохранение выразительной запинки",
        "П-практичность здесь важнее скорости.",
        ["П-практичность"],
        [],
        None,
    ),
    (
        "trailing_word",
        "значимое слово в конце",
        "На странице настроек также",
        ["также"],
        [],
        None,
    ),
    (
        "fragment",
        "фрагментарная речь",
        "И вот поэтому если мы это сделаем раньше",
        ["если мы это сделаем раньше"],
        [],
        None,
    ),
    (
        "path_keep",
        "пути и идентификаторы",
        "Открой файл src/lib/store.ts и посмотри функцию getSettings.",
        ["src/lib/store.ts", "getSettings"],
        [],
        None,
    ),
    (
        "no_answer",
        "не отвечать на вопрос",
        "Как настроить микрофон в приложении?",
        ["микрофон"],
        ["Чтобы настроить", "Шаги", "1."],
        None,
    ),
    (
        "punct_caps",
        "пунктуация и заглавные",
        "мы запустили новый проект он работает хорошо но есть проблемы",
        ["Мы"],
        [],
        None,
    ),
    (
        "url_keep",
        "ссылка",
        "Документация лежит на https://example.com/docs и обновляется каждую неделю.",
        ["https://example.com/docs"],
        [],
        None,
    ),
    (
        "long_dictation",
        "длинная диктовка",
        "Эм, значит, мы вчера обсудили, э, три задачи: первая — обновить интерфейс, "
        "вторая — починить экспорт, третья — написать документацию. Короче, "
        "я беру на себя первую и третью.",
        ["обновить интерфейс", "починить экспорт", "написать документацию"],
        [],
        None,
    ),
    (
        "no_paraphrase",
        "запрет пересказа",
        "Мне кажется это не очень хорошая идея но давай попробуем",
        ["не очень хорошая идея"],
        ["Однако", "Тем не менее"],
        None,
    ),
    (
        "list_keep",
        "перечисление",
        "Купи хлеб молоко сыр и яйца",
        ["хлеб", "молоко", "сыр", "яйца"],
        [],
        None,
    ),
    (
        "quote_keep",
        "цитата",
        "Он сказал цитата мы всё успеем конец цитаты и вышел.",
        ["мы всё успеем"],
        [],
        None,
    ),
    (
        "unit_math",
        "единицы и вычисления",
        "Скорость примерно сто двадцать километров в час, это тридцать три метра в секунду.",
        ["сто двадцать километров в час", "тридцать три метра"],
        [],
        None,
    ),
]


def call(port: int, model: str, prompt: str, text: str, timeout: float) -> tuple[str, float]:
    payload = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": text},
            ],
            "temperature": TEMPERATURE,
            "stream": False,
            "max_tokens": MAX_TOKENS,
        }
    ).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = json.loads(response.read())
    elapsed = time.perf_counter() - started
    content = body["choices"][0]["message"]["content"]
    return content.strip(), elapsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18090)
    parser.add_argument("--model", default="Qwen3-1.7B-Q4_K_M")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--json-out", default="/tmp/talkee-eval/results.json")
    parser.add_argument("--prompt", default=str(PROMPT_PATH))
    args = parser.parse_args()

    prompt_file = Path(args.prompt)
    if not prompt_file.is_file():
        print(
            f"Cleanup prompt not found at {prompt_file}. Dump it first; "
            "see the module docstring for the exact command."
        )
        return 2
    prompt = prompt_file.read_text(encoding="utf-8") + SUFFIX
    results = []
    failures = 0

    for case_id, category, raw, must, must_not, exact in CASES:
        try:
            cleaned, elapsed = call(args.port, args.model, prompt, raw, args.timeout)
            error = None
        except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as exc:
            cleaned, elapsed, error = "", args.timeout, str(exc)

        problems: list[str] = []
        if error:
            problems.append(f"error: {error}")
        else:
            lowered = cleaned.lower()
            for needle in must:
                if needle.lower() not in lowered:
                    problems.append(f"missing: {needle}")
            for needle in must_not:
                if needle.lower() in lowered:
                    problems.append(f"forbidden: {needle}")
            if exact is not None and cleaned != exact:
                problems.append(f"not exact: {cleaned}")
            if case_id == "punct_caps" and cleaned[:1].islower():
                problems.append("capitalization not fixed")
        if problems:
            failures += 1

        results.append(
            {
                "id": case_id,
                "category": category,
                "raw": raw,
                "cleaned": cleaned,
                "seconds": round(elapsed, 3),
                "problems": problems,
            }
        )
        status = "OK " if not problems else "FAIL"
        print(f"[{status}] {case_id:16s} {elapsed:5.2f}s  {cleaned!r}")
        for problem in problems:
            print(f"        -> {problem}")

    # Filler handling is reported, not scored: the active style allows keeping
    # an ambiguous discourse marker.
    for item in results:
        if item["id"] == "fillers":
            item["filler_kept"] = any(
                word in item["cleaned"].lower() for word in ("короче", "типа")
            )

    times = [item["seconds"] for item in results if item["cleaned"]]
    summary = {
        "model": args.model,
        "cases": len(results),
        "passed": len(results) - failures,
        "failed": failures,
        "median_seconds": round(statistics.median(times), 3) if times else None,
        "max_seconds": round(max(times), 3) if times else None,
        "over_12s": sum(1 for value in times if value > 12.0),
    }
    Path(args.json_out).write_text(
        json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print()
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
