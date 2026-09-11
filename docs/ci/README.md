# CI assets awaiting installation

`secret-scan.yml` هو تعريف GitHub Actions لفحص الأسرار عبر كامل تاريخ Git
باستخدام Gitleaks.

> **لماذا ليس في `.github/workflows/`؟** — هوية الأتمتة التي أنشأت هذا الفرع
> (GitHub App) لا تملك صلاحية `workflows`، لذا لا يمكنها الدفع إلى مسار
> `.github/workflows/`. على مالك المستودع تنفيذ النقلة الوحيدة التالية:
>
> ```bash
> mkdir -p .github/workflows
> cp docs/ci/secret-scan.yml .github/workflows/secret-scan.yml
> git add .github/workflows/secret-scan.yml
> git commit -m "ci: activate gitleaks secret scanning workflow"
> git push
> ```
>
> أو عبر واجهة GitHub: Add file → Upload files → `.github/workflows/secret-scan.yml`.
>
> حتى تُنقَل إلى ذلك المسار لن يعمل الفحص تلقائياً (GitHub Actions لا يلتقط
> الملفات خارجه). اختبار الانحدار المرتبط يتخطى نفسه (skip) طالما الملف غائب
> ثم يصبح فعّالاً فور وجوده.
