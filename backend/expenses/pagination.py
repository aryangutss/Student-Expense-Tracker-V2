"""Pagination: DRF's stock PageNumberPagination ignores a ``page_size``
query parameter unless the class itself sets ``page_size_query_param``
(the REST_FRAMEWORK settings keys for it do not exist), so the frontend's
page_size requests (page lists, CSV export up to 1000 rows) would silently
get 20 rows. This class makes the parameter real.
"""

from rest_framework.pagination import PageNumberPagination


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 1000
