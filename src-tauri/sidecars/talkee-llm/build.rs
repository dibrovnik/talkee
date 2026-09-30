use std::process::Command;

fn main() {
    link_apple_compiler_rt();
}

/// ggml's Objective-C sources use `@available` checks that lower to the
/// compiler-rt `___isPlatformVersionAtLeast` helper. Rust links with
/// `-nodefaultlibs`, so when the macOS deployment target is lower than a
/// checked version the helper archive clang would normally add is missing.
/// Link clang's runtime archive explicitly to keep the Metal backend buildable
/// at `MACOSX_DEPLOYMENT_TARGET=14.0`.
fn link_apple_compiler_rt() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let Ok(output) = Command::new("clang").arg("--print-runtime-dir").output() else {
        return;
    };
    if !output.status.success() {
        return;
    }

    let runtime_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if runtime_dir.is_empty() {
        return;
    }

    println!("cargo:rustc-link-search=native={runtime_dir}");
    println!("cargo:rustc-link-arg=-lclang_rt.osx");
}
