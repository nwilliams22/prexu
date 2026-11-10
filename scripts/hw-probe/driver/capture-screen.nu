# Keep backend selection and prexu-s83x retry hardening in the shared I/O layer.
use ../lib.nu capture-screen

def main [out: string] {
    let backend = (capture-screen $out)
    if $backend == null { exit 1 }
    print $backend
}
