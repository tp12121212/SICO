#!/usr/bin/env python3
"""
Validate Microsoft built-in SIT reference URLs against dataset records and an optional allowlist.

Outputs:
  - JSON report (machine-readable)
  - Markdown report (human-readable)
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


MICROSOFT_SIT_PATH_RE = re.compile(r"/purview/sit-defn-", re.IGNORECASE)


@dataclass(frozen=True)
class SitRecord:
    slug: str
    name: str
    author: str
    source: str
    provenance_type: str
    reference_url: str | None
    raw_references: list[Any]


def normalize_url(url: str) -> str:
    parsed = urlparse(url.strip())
    scheme = (parsed.scheme or "https").lower()
    netloc = parsed.netloc.lower()
    path = parsed.path or "/"
    path = re.sub(r"/+$", "", path) or "/"
    return f"{scheme}://{netloc}{path}"


def is_microsoft_sit_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.netloc.lower() != "learn.microsoft.com":
        return False
    return bool(MICROSOFT_SIT_PATH_RE.search(parsed.path))


def clean_title_to_name(title: str) -> str:
    cleaned = re.sub(r"\s*[-|]\s*Microsoft\s+Learn.*$", "", title, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"\s+entity\s+definition\s*$", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def extract_title(html: str) -> str | None:
    og = re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', html, re.IGNORECASE)
    if og:
        return og.group(1).strip()

    title = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if title:
        return re.sub(r"\s+", " ", title.group(1)).strip()
    return None


def load_allowlist(path: Path | None) -> set[str]:
    if not path:
        return set()
    values: set[str] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        values.add(normalize_url(line))
    return values


def extract_reference_url(references: list[Any]) -> str | None:
    for ref in references:
        if isinstance(ref, str):
            if is_microsoft_sit_url(ref):
                return normalize_url(ref)
        elif isinstance(ref, dict):
            maybe = ref.get("url")
            if isinstance(maybe, str) and is_microsoft_sit_url(maybe):
                return normalize_url(maybe)
    return None


def load_records(patterns_path: Path) -> list[SitRecord]:
    data = json.loads(patterns_path.read_text(encoding="utf-8"))
    records: list[SitRecord] = []
    for row in data.get("patterns", []):
        refs = row.get("references") if isinstance(row.get("references"), list) else []
        source = str(row.get("source") or "").strip()
        author = str(row.get("author") or "").strip()
        provenance_type = str(row.get("provenance_type") or "").strip()
        ref_url = extract_reference_url(refs)
        records.append(
            SitRecord(
                slug=str(row.get("slug") or "").strip(),
                name=str(row.get("name") or "").strip(),
                author=author,
                source=source,
                provenance_type=provenance_type,
                reference_url=ref_url,
                raw_references=refs,
            )
        )
    return records


def is_built_in(record: SitRecord) -> bool:
    if record.provenance_type.lower() == "built-in":
        return True
    if "microsoft" in record.author.lower() or "microsoft" in record.source.lower():
        return True
    return bool(record.reference_url and is_microsoft_sit_url(record.reference_url))


def fetch_url(url: str, timeout: int, retries: int, base_delay: float) -> dict[str, Any]:
    attempt = 0
    while True:
        attempt += 1
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (SICO-SIT-URL-Audit)"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", errors="ignore")
                final_url = normalize_url(resp.geturl())
                title = extract_title(body)
                return {
                    "input_url": url,
                    "final_url": final_url,
                    "status": int(getattr(resp, "status", 200)),
                    "title": title or "",
                    "clean_name": clean_title_to_name(title or ""),
                }
        except urllib.error.HTTPError as exc:
            retryable = exc.code in {429, 500, 502, 503, 504}
            if not retryable or attempt > retries:
                raise
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            if retry_after and str(retry_after).isdigit():
                delay = float(retry_after)
            else:
                delay = base_delay * (2 ** (attempt - 1))
            time.sleep(min(delay, 30.0))
        except urllib.error.URLError:
            if attempt > retries:
                raise
            delay = base_delay * (2 ** (attempt - 1))
            time.sleep(min(delay, 30.0))


def build_reports(
    records: list[SitRecord],
    allowlist: set[str],
    timeout: int,
    workers: int,
    fetch_enabled: bool,
    retries: int,
    base_delay: float,
) -> dict[str, Any]:
    built_ins = [record for record in records if is_built_in(record)]
    built_ins.sort(key=lambda item: (item.slug, item.name))

    missing_reference: list[dict[str, Any]] = []
    non_microsoft_reference: list[dict[str, Any]] = []
    unexpected_url: list[dict[str, Any]] = []
    name_mismatch: list[dict[str, Any]] = []
    duplicate_url_map: dict[str, list[str]] = {}
    fetch_errors: list[dict[str, Any]] = []
    redirects: list[dict[str, Any]] = []

    used_urls: set[str] = set()
    for item in built_ins:
        if not item.reference_url:
            missing_reference.append({"slug": item.slug, "name": item.name})
            continue
        if not is_microsoft_sit_url(item.reference_url):
            non_microsoft_reference.append({"slug": item.slug, "name": item.name, "url": item.reference_url})
            continue
        used_urls.add(item.reference_url)
        duplicate_url_map.setdefault(item.reference_url, []).append(item.slug)

    if allowlist:
        for item in built_ins:
            if item.reference_url and item.reference_url not in allowlist:
                unexpected_url.append(
                    {
                        "slug": item.slug,
                        "name": item.name,
                        "url": item.reference_url,
                    }
                )

    fetch_results: dict[str, dict[str, Any]] = {}
    if fetch_enabled:
        url_list = sorted(used_urls | allowlist)
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            future_map = {pool.submit(fetch_url, url, timeout, retries, base_delay): url for url in url_list}
            for future in concurrent.futures.as_completed(future_map):
                url = future_map[future]
                try:
                    fetch_results[url] = future.result()
                except Exception as exc:  # noqa: BLE001
                    fetch_errors.append({"url": url, "error": str(exc)})

        for item in built_ins:
            if not item.reference_url:
                continue
            fetched = fetch_results.get(item.reference_url)
            if not fetched:
                continue
            if fetched["final_url"] != item.reference_url:
                redirects.append(
                    {"slug": item.slug, "from": item.reference_url, "to": fetched["final_url"]}
                )

            clean_name = str(fetched.get("clean_name") or "").strip()
            if clean_name and item.name.strip() != clean_name:
                name_mismatch.append(
                    {
                        "slug": item.slug,
                        "record_name": item.name,
                        "expected_name": clean_name,
                        "url": item.reference_url,
                    }
                )

    duplicate_urls = [
        {"url": url, "slugs": sorted(slugs)}
        for url, slugs in duplicate_url_map.items()
        if len(slugs) > 1
    ]
    duplicate_urls.sort(key=lambda row: row["url"])

    missing_from_records = sorted(allowlist - used_urls) if allowlist else []

    report = {
        "summary": {
            "total_records": len(records),
            "built_in_records": len(built_ins),
            "with_reference_url": len(used_urls),
            "allowlist_count": len(allowlist),
            "missing_reference_count": len(missing_reference),
            "non_microsoft_reference_count": len(non_microsoft_reference),
            "unexpected_url_count": len(unexpected_url),
            "missing_from_records_count": len(missing_from_records),
            "duplicate_url_count": len(duplicate_urls),
            "name_mismatch_count": len(name_mismatch),
            "redirect_count": len(redirects),
            "fetch_error_count": len(fetch_errors),
        },
        "missing_reference": sorted(missing_reference, key=lambda x: x["slug"]),
        "non_microsoft_reference": sorted(non_microsoft_reference, key=lambda x: x["slug"]),
        "unexpected_url": sorted(unexpected_url, key=lambda x: x["slug"]),
        "missing_from_records": missing_from_records,
        "duplicate_urls": duplicate_urls,
        "name_mismatch": sorted(name_mismatch, key=lambda x: x["slug"]),
        "redirects": sorted(redirects, key=lambda x: (x["slug"], x["from"])),
        "fetch_errors": sorted(fetch_errors, key=lambda x: x["url"]),
    }
    return report


def write_markdown(report: dict[str, Any], path: Path, allowlist_path: Path | None) -> None:
    summary = report["summary"]
    lines: list[str] = []
    lines.append("# Microsoft SIT URL Audit")
    lines.append("")
    if allowlist_path:
        lines.append(f"Allowlist: `{allowlist_path}`")
        lines.append("")
    lines.append("## Summary")
    for key in sorted(summary.keys()):
        lines.append(f"- `{key}`: {summary[key]}")

    def section(title: str, rows: list[dict[str, Any]], keys: list[str]) -> None:
        lines.append("")
        lines.append(f"## {title} ({len(rows)})")
        if not rows:
            lines.append("_None_")
            return
        for row in rows:
            parts = [f"`{key}`: {row.get(key)}" for key in keys]
            lines.append(f"- {' | '.join(parts)}")

    section("Missing Reference", report["missing_reference"], ["slug", "name"])
    section("Non-Microsoft Reference", report["non_microsoft_reference"], ["slug", "name", "url"])
    section("Unexpected URL (not in allowlist)", report["unexpected_url"], ["slug", "name", "url"])
    section("Duplicate URLs", report["duplicate_urls"], ["url", "slugs"])
    section("Name Mismatch", report["name_mismatch"], ["slug", "record_name", "expected_name", "url"])
    section("Redirects", report["redirects"], ["slug", "from", "to"])
    section("Fetch Errors", report["fetch_errors"], ["url", "error"])

    lines.append("")
    lines.append(f"## Missing from Records ({len(report['missing_from_records'])})")
    if report["missing_from_records"]:
        for url in report["missing_from_records"]:
            lines.append(f"- {url}")
    else:
        lines.append("_None_")
    lines.append("")

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Microsoft SIT reference URLs in patterns.json")
    parser.add_argument(
        "--patterns",
        default="dashboard/src/data/sit/patterns.json",
        help="Path to SIT dataset JSON",
    )
    parser.add_argument(
        "--allowlist",
        default="dashboard/docs/microsoft-sit-url-allowlist.txt",
        help="Path to URL allowlist file (one URL per line). If missing, allowlist checks are skipped.",
    )
    parser.add_argument(
        "--output-json",
        default="dashboard/docs/microsoft-sit-url-audit.json",
        help="Path for JSON report",
    )
    parser.add_argument(
        "--output-md",
        default="dashboard/docs/microsoft-sit-url-audit.md",
        help="Path for Markdown report",
    )
    parser.add_argument("--timeout", type=int, default=25, help="Fetch timeout seconds")
    parser.add_argument("--workers", type=int, default=12, help="Concurrent fetch workers")
    parser.add_argument("--retries", type=int, default=5, help="Retry count for transient HTTP/network failures")
    parser.add_argument(
        "--base-delay",
        type=float,
        default=1.0,
        help="Base delay seconds for exponential backoff (used for retryable errors)",
    )
    parser.add_argument("--no-fetch", action="store_true", help="Skip URL fetch and title checks")
    args = parser.parse_args()

    patterns_path = Path(args.patterns)
    allowlist_path = Path(args.allowlist)
    allowlist = load_allowlist(allowlist_path) if allowlist_path.exists() else set()

    records = load_records(patterns_path)
    report = build_reports(
        records=records,
        allowlist=allowlist,
        timeout=args.timeout,
        workers=args.workers,
        fetch_enabled=not args.no_fetch,
        retries=args.retries,
        base_delay=args.base_delay,
    )

    output_json = Path(args.output_json)
    output_md = Path(args.output_md)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_md.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_markdown(report, output_md, allowlist_path if allowlist else None)

    print(f"Wrote JSON report: {output_json}")
    print(f"Wrote Markdown report: {output_md}")
    print("Summary:")
    for key, value in sorted(report["summary"].items()):
        print(f"  {key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
