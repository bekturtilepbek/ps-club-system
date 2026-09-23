from decimal import Decimal

from core.domain.money import open_time_amount, round_som


def test_round_som_rounds_half_up():
    assert round_som(Decimal("2.5")) == 3
    assert round_som(Decimal("2.4")) == 2
    assert round_som(Decimal("2.5001")) == 3


def test_open_time_amount_zero_elapsed_is_free():
    assert open_time_amount(0, hourly_rate=120) == 0


def test_open_time_amount_exact_half_hour():
    # 1800s = 30 min, ставка 120 сом/час -> 60 сом ровно
    assert open_time_amount(1800, hourly_rate=120) == 60


def test_open_time_amount_rounds_the_final_total():
    # 1 минута при ставке 150 сом/час -> 2.5 сом -> округление до 3
    assert open_time_amount(60, hourly_rate=150) == 3
    # 90 секунд при ставке 60 сом/час -> 1.5 сом -> округление до 2
    assert open_time_amount(90, hourly_rate=60) == 2
