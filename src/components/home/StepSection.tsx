import { CheckCircle2, ClipboardList, Search, ShieldCheck, type LucideIcon } from "lucide-react";

export default function StepSection() {
  const steps = [
    {
      number: "01",
      title: "Tell us what you need",
      description:
        "Simply describe the task—big or small. Whether it's changing a lightbulb or weekly grocery shopping, we've got you.",
      icon: ClipboardList,
      accent: "bg-[#0B5FFF]",
      reverse: false,
    },
    {
      number: "02",
      title: "Choose your Caddy",
      description:
        "Review profiles, ratings, and friendly faces. Pick the helper that feels like the right fit for your home.",
      icon: Search,
      accent: "bg-[#F6B14A]",
      reverse: true,
    },
    {
      number: "03",
      title: "Sit back and relax",
      description:
        "Your helper arrives, gets the job done, and you securely pay through the app once you're 100% happy.",
      icon: CheckCircle2,
      accent: "bg-[#7CBFA3]",
      reverse: false,
    },
  ];

  return (
    <section id="how-it-works" className="bg-[#DDE2F2] py-24">
      <div className="mx-auto max-w-7xl px-8">

        <h2 className="mb-20 text-center text-5xl font-bold text-[#20212A]">
          Simple as 1-2-3
        </h2>

        <div className="space-y-20">

          {steps.map((step) => (
            <div
              key={step.number}
              className={`flex flex-col items-center gap-16 lg:flex-row ${
                step.reverse ? "lg:flex-row-reverse" : ""
              }`}
            >
              {/* Text */}

              <div className="flex-1">

                <div className="text-7xl font-extrabold text-[#C4CDEA]">
                  {step.number}
                </div>

                <h3 className="mt-2 text-4xl font-bold text-[#20212A]">
                  {step.title}
                </h3>

                <p className="mt-6 max-w-md leading-8 text-gray-600">
                  {step.description}
                </p>

              </div>

              {/* Image */}

              <div className="flex flex-1 justify-center">
                <StepIllustration icon={step.icon} accent={step.accent} title={step.title} />

              </div>

            </div>
          ))}

        </div>

      </div>
    </section>
  );
}

function StepIllustration({
  icon: Icon,
  accent,
  title,
}: {
  icon: LucideIcon;
  accent: string;
  title: string;
}) {
  return (
    <div
      aria-label={title}
      className="relative flex aspect-[4/3] w-full max-w-md items-center justify-center overflow-hidden rounded-[28px] bg-white shadow-xl"
    >
      <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[#F2F4FA]" />
      <div className="absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-[#F2F4FA]" />
      <div className={`relative flex h-32 w-32 items-center justify-center rounded-[32px] ${accent} shadow-lg`}>
        <Icon size={64} strokeWidth={1.5} className="text-white" aria-hidden="true" />
      </div>
      <ShieldCheck
        size={28}
        className="absolute bottom-8 right-10 rounded-full bg-white p-1 text-[#0B5FFF] shadow-md"
        aria-label="Trusted and secure"
      />
    </div>
  );
}