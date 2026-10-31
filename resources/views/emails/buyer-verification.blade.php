<!doctype html>
<html lang="ar" dir="rtl">
<body style="font-family:Arial,sans-serif;line-height:1.8;color:#1f2937">
    <h2>تأكيد البريد الإلكتروني</h2>
    <p>@if($retail)طلبتَ فتح حساب في «{{ $storeName }}».@else طلبتَ فتح حساب مشتري جملة في «{{ $storeName }}».@endif اضغط الرابط التالي لتأكيد بريدك الإلكتروني. الرابط صالح لمدة {{ intdiv($ttlMinutes, 60) >= 1 ? intdiv($ttlMinutes, 60).' ساعة' : $ttlMinutes.' دقيقة' }} ويُستخدم مرة واحدة:</p>
    <p><a href="{{ $url }}">تأكيد البريد الإلكتروني</a></p>
    @if($retail)
    <p>بعد التأكيد يمكنك تسجيل الدخول وإدارة طلباتك وعناوينك.</p>
    @else
    <p>بعد التأكيد، يراجع المتجر طلب عضوية الجملة قبل عرض أسعار الجملة.</p>
    @endif
    <p>إذا لم تطلب ذلك، تجاهل هذه الرسالة.</p>
    <hr>
    <div dir="ltr" style="text-align:left">
        <h3>Confirm your email</h3>
        <p>You asked to open @if($retail)an account @else a wholesale buyer account @endif at “{{ $storeName }}”. Use the link below to confirm your email address. The link is valid for {{ intdiv($ttlMinutes, 60) >= 1 ? intdiv($ttlMinutes, 60).' hour(s)' : $ttlMinutes.' minutes' }} and can be used once:</p>
        <p><a href="{{ $url }}">Confirm email address</a></p>
        @if($retail)
        <p>After you confirm you can sign in and manage your orders and addresses.</p>
        @else
        <p>After you confirm, the store reviews your wholesale membership request before showing wholesale prices.</p>
        @endif
        <p>If you did not request this, ignore this message.</p>
    </div>
</body>
</html>
