fn main() {
    println!("cargo:rerun-if-changed=web/dist");
    for f in ["index.html", "main.js"] {
        if !std::path::Path::new("web/dist").join(f).exists() {
            panic!("web/dist/{f} est absent : lancez d'abord `npm run build`.");
        }
    }
}
