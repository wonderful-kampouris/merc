// Screenshot harness only: @wonderful/ui-base imports useInfiniteQuery (AsyncSelect) from this optional peer,
// which is not installed in app/app. None of the WP-APP-05 screens use AsyncSelect.
export function useInfiniteQuery() {
  return { data: undefined, isLoading: false, isFetching: false, hasNextPage: false, fetchNextPage: () => {}, error: null };
}
