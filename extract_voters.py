import argparse
import json
import re
import sys
from pathlib import Path

try:
    import pymupdf
    from indic_transliteration import sanscript
    from indic_transliteration.sanscript import transliterate
except ImportError as exc:
    raise SystemExit(
        "A required package is not installed. Run: "
        "python -m pip install -r requirements.txt"
    ) from exc


HEADER_CODE = re.compile(r"\b\d+\s*-\s*\d+\s*-\s*\d+\b")
VOTER_ID = re.compile(r"(?<![A-Z0-9])[A-Z]{3}\d{7}(?![A-Z0-9])")
SERIAL_NUMBER = re.compile(r"\d+")
MALE_GENDER_VALUES = {"పు", "పురుష", "పురుషుడు"}
FEMALE_GENDER_VALUES = {"స్త్రీ", "మహిళ"}


def clean_text(value: str) -> str:
    return " ".join(value.split()).strip()


def transliterate_name(value: str) -> str:
    value = transliterate(value, sanscript.TELUGU, sanscript.ITRANS)
    value = value.translate(
        str.maketrans(
            {
                "è": "e",
                "ò": "o",
                "\u0c3c": "",
                "\u0c58": "tsa",
                "\u0c5a": "rra",
                "\u0c5b": "rra",
                "\u200c": "",
            }
        )
    )
    value = re.sub(r"M(?=[pPbBmM])", "m", value)
    value = re.sub(r"M(?=[A-Za-z])", "n", value)
    value = value.replace("~N", "n").replace("~n", "n")
    value = "".join(
        character
        for character in value
        if character.isascii() and (character.isalnum() or character.isspace())
    )
    words = value.split()
    if not words:
        raise ValueError("Could not transliterate a voter name")
    return " ".join(word.lower().capitalize() for word in words)


def extract_ward_number(blocks: list[tuple], page_number: int) -> int:
    ward_blocks = [
        block
        for block in blocks
        if block[0] > 450
        and block[1] < 110
        and "వార్డు" in str(block[4])
    ]
    if len(ward_blocks) != 1:
        raise ValueError(
            f"Expected one ward number in the page header on page {page_number}"
        )

    match = re.search(r"[:：]\s*(\d+)", str(ward_blocks[0][4]))
    if match is None:
        raise ValueError(f"Could not parse ward number on page {page_number}")
    return int(match.group(1))


def extract_field_values(blocks: list[tuple], header: tuple, id_block: tuple) -> list[str]:
    x_position = header[0]
    header_y = header[1]
    id_y = id_block[1]
    field_blocks = sorted(
        (
            block
            for block in blocks
            if abs(block[0] - x_position) < 6
            and header_y + 2 < block[1] < id_y - 1
            and not HEADER_CODE.search(str(block[4]))
            and not VOTER_ID.search(str(block[4]))
        ),
        key=lambda block: block[1],
    )

    values = []
    awaiting_value = False
    for block in field_blocks:
        for line in str(block[4]).splitlines():
            line = line.strip()
            if not line:
                continue
            if ":" in line or "：" in line:
                value = re.split(r"[:：]", line, maxsplit=1)[1].strip()
                if value:
                    values.append(clean_text(value))
                    awaiting_value = False
                else:
                    awaiting_value = True
            elif awaiting_value:
                values.append(clean_text(line))
                awaiting_value = False
    return values


def normalize_gender(value: str) -> str:
    if value in MALE_GENDER_VALUES:
        return "Male"
    if value in FEMALE_GENDER_VALUES:
        return "Female"
    return value


def parse_age(value: str, page_number: int, serial_number: int) -> int:
    match = re.fullmatch(r"\s*(\d{1,3})\s*", value)
    if match is None:
        raise ValueError(
            f"Could not parse age for serial {serial_number} on page {page_number}"
        )
    return int(match.group(1))


def extract_voters(pdf_path: Path) -> list[dict]:
    voters = []
    with pymupdf.open(pdf_path) as document:
        for page_number, page in enumerate(document, start=1):
            blocks = [
                block
                for block in page.get_text("blocks")
                if len(block) > 4 and str(block[4]).strip()
            ]
            id_blocks = [
                block for block in blocks if VOTER_ID.search(str(block[4]))
            ]
            ward_number = (
                extract_ward_number(blocks, page_number) if id_blocks else None
            )

            for id_block in id_blocks:
                voter_id = VOTER_ID.search(str(id_block[4])).group()
                x_position = id_block[0]
                id_y = id_block[1]
                headers = [
                    block
                    for block in blocks
                    if abs(block[0] - x_position) < 6
                    and id_y - 75 < block[1] < id_y - 50
                    and HEADER_CODE.search(str(block[4]))
                ]
                if not headers:
                    raise ValueError(
                        f"Could not find the card header for a voter ID "
                        f"on page {page_number}"
                    )

                header = max(headers, key=lambda block: block[1])
                first_line = str(header[4]).splitlines()[0]
                serial_match = SERIAL_NUMBER.search(first_line)
                if serial_match is None:
                    raise ValueError(
                        f"Could not parse a serial number on page {page_number}"
                    )
                serial_number = int(serial_match.group())

                values = extract_field_values(blocks, header, id_block)
                if len(values) == 5:
                    house_number = values[4]
                elif len(values) == 4 and values[3] in (
                    MALE_GENDER_VALUES | FEMALE_GENDER_VALUES
                ):
                    parse_age(values[2], page_number, serial_number)
                    house_number = None
                else:
                    raise ValueError(
                        f"Expected five card fields but found {len(values)} "
                        f"for serial {serial_number} on page {page_number}"
                    )

                voters.append(
                    {
                        "wardno": ward_number,
                        "serialNumber": serial_number,
                        "voterName": values[0],
                        "voterNameEn": transliterate_name(values[0]),
                        "relationName": values[1],
                        "age": parse_age(values[2], page_number, serial_number),
                        "gender": normalize_gender(values[3]),
                        "houseNumber": house_number,
                        "voterId": voter_id,
                        "pageNumber": page_number,
                    }
                )

    serial_numbers = [voter["serialNumber"] for voter in voters]
    if len(serial_numbers) != len(set(serial_numbers)):
        raise ValueError("Duplicate voter serial numbers were found")
    return voters


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract voter records from the Telugu voter-list PDF."
    )
    parser.add_argument("--pdf", required=True, type=Path, help="Input PDF path")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("output") / "voters.json",
        help="Output JSON path (default: output/voters.json)",
    )
    args = parser.parse_args()

    if not args.pdf.is_file():
        raise SystemExit(f"PDF file not found: {args.pdf}")

    voters = extract_voters(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(voters, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Extracted {len(voters)} voter records to {args.output}")
    missing_houses = sum(voter["houseNumber"] is None for voter in voters)
    if missing_houses:
        print(f"Records with no extracted house number: {missing_houses}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, pymupdf.FileDataError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
