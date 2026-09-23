from decimal import ROUND_HALF_UP, Decimal


def round_som(amount: Decimal) -> int:
    return int(amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def open_time_amount(elapsed_seconds: float, hourly_rate: int) -> int:
    """SPEC 3.2: открытое время поминутно, ставка/мин = ставка/час / 60,
    округляется только итог, а не каждая минута."""
    if elapsed_seconds <= 0:
        return 0
    elapsed_minutes = Decimal(str(elapsed_seconds)) / Decimal(60)
    per_minute_rate = Decimal(hourly_rate) / Decimal(60)
    return round_som(elapsed_minutes * per_minute_rate)
