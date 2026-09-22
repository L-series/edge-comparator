"""Tests for health and hardware catalog endpoints and contract invariants."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_endpoint(async_client: AsyncClient) -> None:
    """GET /api/health returns status ok."""
    response = await async_client.get("/api/health")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    data = response.json()
    assert data == {"status": "ok"}


@pytest.mark.asyncio
async def test_targets_catalog_invariants(async_client: AsyncClient) -> None:
    """GET /api/targets returns exactly three source-backed catalogue entries."""
    response = await async_client.get("/api/targets")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    targets = response.json()

    # Exact count: exactly three catalogue entries
    assert isinstance(targets, list)
    assert len(targets) == 3

    # Expected IDs
    target_ids = [t["id"] for t in targets]
    expected_ids = [
        "nvidia-jetson-orin-nano",
        "intel-openvino-cpu",
        "nxp-imx93-ethos-u65",
    ]
    assert target_ids == expected_ids

    # Expected fields on every entry
    required_fields = {
        "id",
        "name",
        "vendor",
        "accelerator",
        "source_url",
        "configuration_status",
    }
    for target in targets:
        assert set(target.keys()) == required_fields
        assert target["configuration_status"] == "catalog_only"
        assert target["source_url"].startswith("https://")

    # Entry-specific checks
    nvidia = next(t for t in targets if t["id"] == "nvidia-jetson-orin-nano")
    assert nvidia["vendor"] == "NVIDIA"
    assert "orin nano" in nvidia["name"].lower()
    assert "developer.nvidia.com" in nvidia["source_url"] or "nvidia.com" in nvidia["source_url"]

    intel = next(t for t in targets if t["id"] == "intel-openvino-cpu")
    assert intel["vendor"] == "Intel"
    assert "openvino" in intel["accelerator"].lower() or "cpu" in intel["accelerator"].lower()
    assert "openvino" in intel["source_url"].lower()

    nxp = next(t for t in targets if t["id"] == "nxp-imx93-ethos-u65")
    assert nxp["vendor"] == "NXP"
    assert "ethos-u65" in nxp["accelerator"].lower()
    assert "nxp.com" in nxp["source_url"].lower()
    assert nxp["source_url"] == "https://www.nxp.com/products/i.MX93"

    # Invariant: No unsupported numeric hardware claims (e.g. TOPS, GHz, RAM GB, price $)
    disallowed_terms = ["tops", "ghz", "flit", "$", "€", "usd", "4gb", "8gb", "price"]
    for target in targets:
        for field in ["name", "accelerator"]:
            val = str(target[field]).lower()
            for term in disallowed_terms:
                assert term not in val, f"Found disallowed numeric/pricing term '{term}' in {field}"
