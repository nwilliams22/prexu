use ../verdict.nu check-popout-exit-alloc-gap

def main [log: string, ceiling: int] {
    check-popout-exit-alloc-gap (open --raw $log | lines) --max-gap-ms $ceiling | to json
}
