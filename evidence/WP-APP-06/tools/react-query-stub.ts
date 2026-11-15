// Stand-in for the optional peer `@tanstack/react-query` of @wonderful/ui-base (only AsyncSelect uses it; these screens do not).
export function useInfiniteQuery(): { data: undefined; isLoading: false; fetchNextPage: () => void; hasNextPage: false } {
  return { data: undefined, isLoading: false, fetchNextPage: () => {}, hasNextPage: false };
}
export function useQuery(): { data: undefined; isLoading: false } {
  return { data: undefined, isLoading: false };
}
