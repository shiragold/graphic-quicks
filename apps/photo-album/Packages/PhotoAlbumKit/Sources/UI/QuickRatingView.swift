import SwiftUI
import Usage

/// The Quick Rating: a small 👍 / 👎 capsule that overlays a Collage on the results screen.
/// One tap rates, the close button (or Escape) dismisses, and there is no text entry. It never
/// changes the Collage. Show it only when `UsageLog.shouldOfferQuickRating(for:)` says so.
public struct QuickRatingView: View {
    private let onRate: (QuickRating) -> Void
    private let onDismiss: () -> Void

    @State private var chosen: QuickRating?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(onRate: @escaping (QuickRating) -> Void, onDismiss: @escaping () -> Void) {
        self.onRate = onRate
        self.onDismiss = onDismiss
    }

    public var body: some View {
        HStack(spacing: 2) {
            button(.up, symbol: "hand.thumbsup", label: "Good collage")
            button(.down, symbol: "hand.thumbsdown", label: "Not a good collage")
            Divider().frame(height: 16).padding(.horizontal, 2)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .frame(width: 24, height: 24)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Close rating")
            .help("Close")
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .glassEffect(.regular, in: .capsule)
        .disabled(chosen != nil)
        .onExitCommand(perform: onDismiss)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Rate this collage")
        .accessibilityHint("Optional. Your rating stays on this Mac.")
    }

    private func button(_ rating: QuickRating, symbol: String, label: String) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .snappy) { chosen = rating }
            onRate(rating)
        } label: {
            Image(systemName: chosen == rating ? symbol + ".fill" : symbol)
                .font(.body)
                .frame(width: 28, height: 24)
                .contentShape(.capsule)
                .symbolEffect(.bounce, value: chosen == rating)
        }
        .buttonStyle(.plain)
        .foregroundStyle(chosen == rating ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
        .accessibilityLabel(label)
        .accessibilityAddTraits(chosen == rating ? .isSelected : [])
        .help(label)
    }
}

extension View {
    /// Overlays the Quick Rating in the Collage's bottom-trailing corner while `isPresented`.
    /// It hides itself after a rating or a dismissal.
    public func quickRating(
        isPresented: Binding<Bool>,
        onRate: @escaping (QuickRating) -> Void,
        onDismiss: @escaping () -> Void
    ) -> some View {
        modifier(QuickRatingOverlay(isPresented: isPresented, onRate: onRate, onDismiss: onDismiss))
    }
}

private struct QuickRatingOverlay: ViewModifier {
    @Binding var isPresented: Bool
    let onRate: (QuickRating) -> Void
    let onDismiss: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottomTrailing) {
            if isPresented {
                QuickRatingView(
                    onRate: { rating in
                        onRate(rating)
                        // Leave the filled thumb visible for a moment as confirmation.
                        Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(700))
                            withAnimation(reduceMotion ? nil : .default) { isPresented = false }
                        }
                    },
                    onDismiss: {
                        onDismiss()
                        withAnimation(reduceMotion ? nil : .default) { isPresented = false }
                    })
                .padding(10)
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.9, anchor: .bottomTrailing)))
            }
        }
    }
}

// `PreviewProvider` rather than `#Preview`: the macro's plugin ships only with Xcode, and the
// package also builds with the Command Line Tools.
struct QuickRatingView_Previews: PreviewProvider {
    private struct Demo: View {
        @State private var isPresented = true
        @State private var last = "—"

        var body: some View {
            VStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(.orange.gradient)
                    .frame(width: 360, height: 360)
                    .overlay(Text("Collage").font(.title).foregroundStyle(.white))
                    .quickRating(
                        isPresented: $isPresented,
                        onRate: { last = $0.rawValue },
                        onDismiss: { last = "dismissed" })
                HStack {
                    Text("Last: \(last)")
                    Button("Show again") { isPresented = true }
                }
            }
            .padding()
        }
    }

    static var previews: some View {
        Demo().previewDisplayName("On a Collage")
        QuickRatingView(onRate: { _ in }, onDismiss: {})
            .padding()
            .previewDisplayName("Control")
        QuickRatingView(onRate: { _ in }, onDismiss: {})
            .padding()
            .preferredColorScheme(.dark)
            .previewDisplayName("Dark")
        QuickRatingView(onRate: { _ in }, onDismiss: {})
            .padding()
            .dynamicTypeSize(.accessibility2)
            .previewDisplayName("Large type")
    }
}
