import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Dices, Shield } from 'lucide-react';
import {
  GENDERS,
  GENDER_LABELS,
  LANGUAGES,
  LIMITS,
  suggestNickname,
  validateDisplayName,
  type Gender,
} from '@orbit/shared';
import { useMe, useUpdateMe } from '@/hooks/queries';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/Field';
import { Logo } from '@/components/ui/Logo';
import { AvatarPicker } from '@/components/auth/AvatarPicker';
import { InterestsInput } from '@/components/auth/InterestsInput';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const STEPS = ['Your vibe', 'About you', 'Safety'];

export default function OnboardingPage() {
  const me = useMe().data!;
  const update = useUpdateMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(me.displayName);
  const [avatar, setAvatar] = useState({ style: me.avatarStyle, seed: me.avatarSeed });
  const [gender, setGender] = useState<Gender>(me.gender);
  const [showGender, setShowGender] = useState(false);
  const [language, setLanguage] = useState(
    me.language || (navigator.language?.slice(0, 2) ?? 'en'),
  );
  const [interests, setInterests] = useState<string[]>(me.interests);
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const nameCheck = validateDisplayName(name);
  const nameError = touched && !nameCheck.ok ? nameCheck.error : null;

  const next = () => {
    setTouched(true);
    if (step === 0 && !nameCheck.ok) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const finish = async () => {
    setError(null);
    if (!adult || !terms) {
      setError('Please confirm both statements to continue.');
      return;
    }
    try {
      await update.mutateAsync({
        displayName: name.trim(),
        avatarStyle: avatar.style,
        avatarSeed: avatar.seed,
        gender,
        showGender,
        language: LANGUAGES.some((l) => l.code === language) ? language : 'other',
        interests,
        confirmAdult: true,
        acceptTerms: true,
        completeOnboarding: true,
      });
      const target = params.get('next');
      const destination = target && target.startsWith('/app') ? target : '/app/chat';
      navigate(destination, {
        replace: true,
        state: destination === '/app/chat' ? { autoStart: true } : undefined,
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center px-4 pb-10 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <Logo className="mb-6" />
      <div className="w-full max-w-lg rounded-3xl border border-border bg-surface p-5 shadow-soft sm:p-8">
        {/* progress */}
        <ol className="mb-6 flex items-center gap-2" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className="flex flex-1 flex-col gap-1.5"
              aria-current={i === step ? 'step' : undefined}
            >
              <span
                className={cn(
                  'h-1.5 rounded-full transition-colors',
                  i <= step ? 'bg-brand-gradient' : 'bg-surface-2',
                )}
              />
              <span className={cn('text-xs font-semibold', i === step ? 'text-fg' : 'text-muted')}>
                {i + 1}. {s}
              </span>
            </li>
          ))}
        </ol>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18 }}
            className="space-y-5"
          >
            {step === 0 && (
              <>
                <div>
                  <h1 className="text-2xl font-extrabold">Pick a name strangers will see</h1>
                  <p className="mt-1 text-sm text-muted">
                    Stay anonymous — don't use your real full name.
                  </p>
                </div>
                <Field
                  label="Display name"
                  error={nameError}
                  hint={`${LIMITS.DISPLAY_NAME_MIN}–${LIMITS.DISPLAY_NAME_MAX} characters`}
                >
                  {(p) => (
                    <div className="flex gap-2">
                      <Input
                        {...p}
                        value={name}
                        maxLength={LIMITS.DISPLAY_NAME_MAX}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={() => setTouched(true)}
                        autoComplete="off"
                        data-autofocus
                      />
                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => setName(suggestNickname())}
                        aria-label="Suggest a random nickname"
                      >
                        <Dices className="h-5 w-5" />
                      </Button>
                    </div>
                  )}
                </Field>
                <AvatarPicker value={avatar} onChange={setAvatar} />
              </>
            )}
            {step === 1 && (
              <>
                <div>
                  <h1 className="text-2xl font-extrabold">A little about you</h1>
                  <p className="mt-1 text-sm text-muted">
                    Optional details. Matching is always random — these never affect who you meet.
                  </p>
                </div>
                <Field label="Gender" hint="Private by default. Never used for matching.">
                  {(p) => (
                    <Select
                      {...p}
                      value={gender}
                      onChange={(e) => setGender(e.target.value as Gender)}
                    >
                      {GENDERS.map((g) => (
                        <option key={g} value={g}>
                          {GENDER_LABELS[g]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Switch
                  checked={showGender}
                  onChange={setShowGender}
                  label="Show gender on my profile"
                  description="Only friends can see your profile."
                />
                <Field label="Preferred language">
                  {(p) => (
                    <Select {...p} value={language} onChange={(e) => setLanguage(e.target.value)}>
                      {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <InterestsInput value={interests} onChange={setInterests} />
              </>
            )}
            {step === 2 && (
              <>
                <div>
                  <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-success/15 text-success">
                    <Shield className="h-6 w-6" aria-hidden />
                  </div>
                  <h1 className="text-2xl font-extrabold">Before you start</h1>
                  <p className="mt-1 text-sm text-muted">
                    This is an adults-only community. A checkbox can't verify age, so we rely on
                    reports and moderation too — please report anyone who seems underage.
                  </p>
                </div>
                <ul className="space-y-2 rounded-2xl bg-surface-2/70 p-4 text-sm text-muted">
                  <li>• Never share personal info like your address, school or phone number.</li>
                  <li>• Links in stranger chats are not clickable — be careful.</li>
                  <li>• Use Report and Block any time. Harassment means a ban.</li>
                </ul>
                <Checkbox checked={adult} onChange={setAdult} invalid={!!error && !adult}>
                  I confirm I am <strong>18 years or older</strong>.
                </Checkbox>
                <Checkbox checked={terms} onChange={setTerms} invalid={!!error && !terms}>
                  I accept the{' '}
                  <a href="/terms" target="_blank" className="font-semibold text-primary underline">
                    Terms
                  </a>
                  ,{' '}
                  <a
                    href="/privacy"
                    target="_blank"
                    className="font-semibold text-primary underline"
                  >
                    Privacy Policy
                  </a>{' '}
                  and{' '}
                  <a
                    href="/guidelines"
                    target="_blank"
                    className="font-semibold text-primary underline"
                  >
                    Community Guidelines
                  </a>
                  .
                </Checkbox>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-danger/10 p-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-7 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={finish} loading={update.isPending} disabled={!adult || !terms}>
              Start chatting
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
