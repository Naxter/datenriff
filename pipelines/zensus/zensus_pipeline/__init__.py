"""Destatis Zensus grid data -> H3 -> binary sculpture buffers.

The dependency-free modules (gridref, special_values, aggregate,
binary_writer) carry the correctness-critical logic and are tested with
the stdlib alone; pyproj/h3 are only needed for full pipeline runs.
"""

__version__ = "0.1.0"
