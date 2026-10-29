// Injected into the resolved updater's offline_tests module by the compatibility
// harness. Tests the actual private extraction boundary without running installers.
#[cfg(target_os = "windows")]
#[test]
fn prexu_raw_and_zip_installer_payloads() {
    use std::io::{Cursor, Write};
    let update = updater().restore_update(manifest()).unwrap().unwrap();
    // Format-identification fixtures, deliberately not executable installers.
    for (name, bytes) in [
        ("setup.exe", b"MZ\x00\x00fixture".as_slice()),
        (
            "setup.msi",
            b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1fixture".as_slice(),
        ),
    ] {
        for zipped in [false, true] {
            let payload = if zipped {
                let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
                writer
                    .start_file(name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                writer.write_all(bytes).unwrap();
                writer.finish().unwrap().into_inner()
            } else {
                bytes.to_vec()
            };
            let extracted = update.extract(&payload).unwrap();
            let path = match &extracted {
                WindowsUpdaterType::Nsis { path, .. } => {
                    assert!(name.ends_with(".exe"));
                    path
                }
                WindowsUpdaterType::Msi { path, .. } => {
                    assert!(name.ends_with(".msi"));
                    path
                }
            };
            assert_eq!(std::fs::read(path).unwrap(), bytes);
            let directory = path.parent().unwrap().to_path_buf();
            drop(extracted);
            std::fs::remove_dir_all(directory).unwrap();
        }
    }
    assert!(update.extract(b"not an installer").is_err());
}
