"""Shared DRF pagination.

The project default was the bare ``PageNumberPagination`` (page size 20) with no
``page_size_query_param``. That silently ignored any client-supplied ``page_size``
on every endpoint without its own paginator, so a screen asking for
``?page_size=500`` still received only the first 20 rows — dropping the rest.

``DefaultPageNumberPagination`` honours ``page_size`` with a safe upper bound so
those screens get the rows they ask for without allowing an unbounded page.
"""

from rest_framework.pagination import PageNumberPagination


class DefaultPageNumberPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 1000
